using System.Diagnostics;
using System.IO.Enumeration;

namespace DiskQuest;

/// <summary>One file or folder in the scanned tree. Kept small: a full drive can be 1M+ nodes.</summary>
sealed class Node
{
    public int Id;
    public string Name = "";
    public Node? Parent;
    public long Size;
    public long Modified;          // UTC ticks
    public int Files;              // number of files at or below this node
    public List<Node>? Children;   // null => this is a file
    public byte Cat;               // file: its category; folder: the category using most bytes inside
    public bool IsDir => Children != null;
}

/// <summary>File-type categories, keyed by extension.</summary>
static class Cats
{
    public static readonly string[] Keys =
        { "other", "video", "image", "audio", "doc", "archive", "code", "app", "game", "system" };
    public static int Count => Keys.Length;

    static readonly Dictionary<string, byte> Map = new(StringComparer.OrdinalIgnoreCase);
    static readonly Dictionary<string, byte>.AlternateLookup<ReadOnlySpan<char>> Lookup;

    static Cats()
    {
        Add(1, "mp4 mkv avi mov wmv flv webm m4v mpg mpeg ts m2ts vob 3gp ogv");
        Add(2, "jpg jpeg png gif bmp webp tif tiff heic heif raw cr2 cr3 nef arw dng psd svg ico avif xcf");
        Add(3, "mp3 wav flac aac ogg m4a wma opus aiff mid midi");
        Add(4, "pdf doc docx xls xlsx ppt pptx txt md rtf odt ods odp epub mobi csv one pub tex");
        Add(5, "zip rar 7z tar gz bz2 xz zst tgz iso img vhd vhdx vmdk vdi wim esd cab");
        Add(6, "js ts jsx tsx py java c cpp cc h hpp cs go rs rb php html htm css scss json xml yml yaml sql sh ps1 bat kt swift dart lua ipynb map pyc class o obj lib a pdb jar");
        Add(7, "exe dll msi msix appx apk so dylib sys ocx drv com scr node pyd bin");
        Add(8, "pak vpk bsa ba2 uasset umap upk wad forge rpf unity3d assets bundle ucas utoc bik arc pck rpa gcf big sav");
        Add(9, "tmp temp log dmp etl bak old cache mui cat inf dat db sqlite ldb pf evtx msp");
        Lookup = Map.GetAlternateLookup<ReadOnlySpan<char>>();
    }

    static void Add(byte cat, string exts)
    {
        foreach (var e in exts.Split(' ')) Map[e] = cat;
    }

    public static byte Of(ReadOnlySpan<char> fileName)
    {
        var ext = Path.GetExtension(fileName);
        return ext.Length > 1 && Lookup.TryGetValue(ext[1..], out var c) ? c : (byte)0;
    }
}

/// <summary>A single scan of a folder or drive: walks the disk in parallel and builds the tree in memory.</summary>
sealed class Scan
{
    public readonly string RootPath;
    public Node? Root;
    public volatile string State = "scanning";   // scanning | done | cancelled | error
    public volatile string Current = "";
    public string? Error;
    public bool Counted;                         // already added to the player's lifetime stats
    public long Files, Dirs, Bytes, CloudBytes;
    public readonly Stopwatch Clock = Stopwatch.StartNew();
    public readonly List<Node?> Nodes = new();   // index == Node.Id; null once removed

    readonly CancellationTokenSource _cts = new();
    readonly ParallelOptions _parallel = new() { MaxDegreeOfParallelism = Math.Max(2, Environment.ProcessorCount) };

    // Files that live only in the cloud (OneDrive "online-only") take no local disk space.
    const FileAttributes CloudOnly = FileAttributes.Offline | (FileAttributes)0x00400000 | (FileAttributes)0x00040000;

    static readonly EnumerationOptions Options = new()
    {
        IgnoreInaccessible = true,
        AttributesToSkip = 0,
        RecurseSubdirectories = false,
        ReturnSpecialDirectories = false,
    };

    readonly record struct Entry(string Name, bool IsDir, long Size, long Modified, FileAttributes Attr, byte Cat);

    public Scan(string rootPath) => RootPath = rootPath;

    public void Start()
    {
        var thread = new Thread(Run, 16 * 1024 * 1024) { IsBackground = true, Name = "scan" };
        thread.Start();
    }

    public void Cancel() => _cts.Cancel();

    void Run()
    {
        try
        {
            if (!Directory.Exists(RootPath)) throw new DirectoryNotFoundException("That folder does not exist.");
            var root = new Node { Name = RootPath, Children = new List<Node>() };
            ScanDir(root, RootPath, 0);
            if (_cts.IsCancellationRequested) { State = "cancelled"; return; }
            Span<long> acc = stackalloc long[Cats.Count];
            acc.Clear();
            Index(root, acc);
            Root = root;
            Clock.Stop();
            State = "done";
        }
        catch (Exception ex)
        {
            Error = ex.Message;
            State = "error";
        }
    }

    void ScanDir(Node dir, string path, int depth)
    {
        if (_cts.IsCancellationRequested) return;
        Current = path;
        var kids = dir.Children!;
        List<Node>? subdirs = null;
        long size = 0, cloud = 0;
        int files = 0;

        try
        {
            var entries = new FileSystemEnumerable<Entry>(path,
                (ref FileSystemEntry e) => new Entry(e.FileName.ToString(), e.IsDirectory, e.Length,
                    e.LastWriteTimeUtc.UtcTicks, e.Attributes, e.IsDirectory ? (byte)0 : Cats.Of(e.FileName)),
                Options);

            foreach (var e in entries)
            {
                if (e.IsDir)
                {
                    // Skip junctions / symlinks so nothing is counted twice and we never loop.
                    if ((e.Attr & FileAttributes.ReparsePoint) != 0 && IsLink(Path.Join(path, e.Name))) continue;
                    var n = new Node { Name = e.Name, Parent = dir, Children = new List<Node>(), Modified = e.Modified };
                    kids.Add(n);
                    (subdirs ??= new List<Node>()).Add(n);
                }
                else
                {
                    if ((e.Attr & CloudOnly) != 0) { cloud += e.Size; continue; }
                    kids.Add(new Node { Name = e.Name, Parent = dir, Size = e.Size, Modified = e.Modified, Files = 1, Cat = e.Cat });
                    size += e.Size;
                    files++;
                }
            }
        }
        catch (Exception) { /* unreadable folder: show what we got */ }

        Interlocked.Add(ref Files, files);
        Interlocked.Add(ref Bytes, size);
        Interlocked.Increment(ref Dirs);
        if (cloud > 0) Interlocked.Add(ref CloudBytes, cloud);

        if (subdirs != null)
        {
            // Fan out near the top of the tree and wherever a folder has many subfolders.
            if (subdirs.Count > 1 && (depth < 4 || subdirs.Count >= 6))
                Parallel.ForEach(subdirs, _parallel, n => ScanDir(n, Path.Join(path, n.Name), depth + 1));
            else
                foreach (var n in subdirs) ScanDir(n, Path.Join(path, n.Name), depth + 1);

            foreach (var n in subdirs) { size += n.Size; files += n.Files; }
        }

        dir.Size = size;
        dir.Files = files;
        kids.Sort(static (a, b) => b.Size.CompareTo(a.Size));
    }

    static bool IsLink(string path)
    {
        try { return new DirectoryInfo(path).LinkTarget != null; }
        catch { return true; }
    }

    /// <summary>Assigns ids and works out each folder's dominant file category.</summary>
    void Index(Node n, Span<long> acc)
    {
        n.Id = Nodes.Count;
        Nodes.Add(n);
        if (n.Children == null) { acc[n.Cat] += n.Size; return; }

        Span<long> mine = stackalloc long[Cats.Count];
        mine.Clear();
        foreach (var c in n.Children) Index(c, mine);
        int best = 0;
        for (int i = 0; i < mine.Length; i++)
        {
            if (mine[i] > mine[best]) best = i;
            acc[i] += mine[i];
        }
        n.Cat = (byte)best;
    }

    public static string PathOf(Node n)
    {
        if (n.Parent == null) return n.Name;
        var parts = new List<string>();
        for (var c = n; c != null; c = c.Parent) parts.Add(c.Name);
        string path = parts[^1];
        for (int i = parts.Count - 2; i >= 0; i--) path = Path.Combine(path, parts[i]);
        return path;
    }

    /// <summary>Removes a node from the tree after it was deleted on disk and fixes sizes above it.</summary>
    public void Detach(Node n)
    {
        var parent = n.Parent;
        if (parent == null) return;
        parent.Children!.Remove(n);
        for (var a = parent; a != null; a = a.Parent)
        {
            a.Size -= n.Size;
            a.Files -= n.Files;
            a.Parent?.Children!.Sort(static (x, y) => y.Size.CompareTo(x.Size));
        }
        Forget(n);
    }

    void Forget(Node n)
    {
        Nodes[n.Id] = null;
        if (n.Children != null) foreach (var c in n.Children) Forget(c);
    }
}
