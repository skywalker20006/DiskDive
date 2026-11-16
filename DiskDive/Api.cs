using System.Buffers;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using Microsoft.VisualBasic.FileIO;

namespace DiskDive;

/// <summary>
/// Everything the UI can ask for. One JSON request in ({id, cmd, args}), one JSON response out,
/// so the same code serves the in-app WebView bridge and the developer HTTP bridge.
/// </summary>
sealed class Api
{
    readonly Func<Func<object?>, object?> _onUiThread;
    readonly Profile _profile = new();
    readonly object _gate = new();   // guards the scan tree
    Scan? _scan;

    public Api(Func<Func<object?>, object?> onUiThread) => _onUiThread = onUiThread;

    public void Shutdown() => _scan?.Cancel();

    public string Handle(string requestJson)
    {
        int id = 0;
        try
        {
            using var doc = JsonDocument.Parse(requestJson);
            var root = doc.RootElement;
            id = root.GetProperty("id").GetInt32();
            string cmd = root.GetProperty("cmd").GetString() ?? "";
            root.TryGetProperty("args", out var args);

            var buffer = new ArrayBufferWriter<byte>(4096);
            using (var w = new Utf8JsonWriter(buffer)) Dispatch(cmd, args, w);
            return $"{{\"id\":{id},\"ok\":true,\"data\":{Encoding.UTF8.GetString(buffer.WrittenSpan)}}}";
        }
        catch (Exception ex)
        {
            return $"{{\"id\":{id},\"ok\":false,\"error\":{JsonSerializer.Serialize(ex.Message)}}}";
        }
    }

    void Dispatch(string cmd, JsonElement a, Utf8JsonWriter w)
    {
        switch (cmd)
        {
            case "home": Home(w); break;
            case "pick": Pick(w); break;
            case "scan": StartScan(Str(a, "path"), w); break;
            case "cancel": _scan?.Cancel(); Empty(w); break;
            case "status": Status(w); break;
            case "view": lock (_gate) View(Int(a, "id"), Math.Clamp(Int(a, "depth", 8), 1, 10), w); break;
            case "info": lock (_gate) { w.WriteStartObject(); WriteItem(w, Get(Int(a, "id")), true); w.WriteEndObject(); } break;
            case "top": lock (_gate) Top(Int(a, "id"), Math.Clamp(Int(a, "n", 40), 1, 200), w); break;
            case "types": lock (_gate) Types(Int(a, "id"), w); break;
            case "quests": lock (_gate) Quests(w); break;
            case "trash": lock (_gate) Trash(a, w); break;
            case "reveal": lock (_gate) Reveal(Get(Int(a, "id"))); Empty(w); break;
            case "bump": _profile.Bump(Str(a, "key"), Num(a, "value"), Str(a, "mode") == "max"); WriteProfileObject(w); break;
            default: throw new InvalidOperationException("Unknown command: " + cmd);
        }
    }

    // ---------------------------------------------------------------- home / scan

    void Home(Utf8JsonWriter w)
    {
        var drives = new List<(string Path, string Label, long Total, long Free)>();
        foreach (var d in DriveInfo.GetDrives())
        {
            try
            {
                if (!d.IsReady || d.DriveType is DriveType.CDRom) continue;
                drives.Add((d.Name, d.VolumeLabel, d.TotalSize, d.TotalFreeSpace));
            }
            catch { /* drive vanished */ }
        }

        string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var places = new (string Name, string Path)[]
        {
            ("Home", home),
            ("Downloads", Path.Combine(home, "Downloads")),
            ("Desktop", Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory)),
            ("Documents", Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments)),
            ("Pictures", Environment.GetFolderPath(Environment.SpecialFolder.MyPictures)),
            ("Videos", Environment.GetFolderPath(Environment.SpecialFolder.MyVideos)),
        };

        w.WriteStartObject();
        w.WriteString("version", "1.0.0");
        w.WriteStartArray("drives");
        foreach (var d in drives)
        {
            w.WriteStartObject();
            w.WriteString("path", d.Path);
            w.WriteString("label", d.Label);
            w.WriteNumber("total", d.Total);
            w.WriteNumber("free", d.Free);
            w.WriteEndObject();
        }
        w.WriteEndArray();
        w.WriteStartArray("places");
        foreach (var p in places)
        {
            if (p.Path.Length == 0 || !Directory.Exists(p.Path)) continue;
            w.WriteStartObject();
            w.WriteString("name", p.Name);
            w.WriteString("path", p.Path);
            w.WriteEndObject();
        }
        w.WriteEndArray();
        w.WritePropertyName("profile");
        WriteProfileObject(w);
        w.WriteEndObject();
    }

    void Pick(Utf8JsonWriter w)
    {
        var path = _onUiThread(() =>
        {
            using var dialog = new FolderBrowserDialog { Description = "Choose a folder to explore", UseDescriptionForTitle = true };
            return dialog.ShowDialog(Form.ActiveForm) == DialogResult.OK ? dialog.SelectedPath : null;
        }) as string;
        w.WriteStartObject();
        if (path == null) w.WriteNull("path"); else w.WriteString("path", path);
        w.WriteEndObject();
    }

    void StartScan(string path, Utf8JsonWriter w)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException("No folder given.");
        path = Path.GetFullPath(path);
        lock (_gate)
        {
            _scan?.Cancel();
            _scan = new Scan(path);
            _scan.Start();
        }
        Empty(w);
    }

    void Status(Utf8JsonWriter w)
    {
        var s = _scan;
        w.WriteStartObject();
        if (s == null) { w.WriteString("state", "idle"); w.WriteEndObject(); return; }
        string state = s.State;
        w.WriteString("state", state);
        w.WriteString("root", s.RootPath);
        w.WriteNumber("files", Interlocked.Read(ref s.Files));
        w.WriteNumber("dirs", Interlocked.Read(ref s.Dirs));
        w.WriteNumber("bytes", Interlocked.Read(ref s.Bytes));
        w.WriteNumber("cloud", Interlocked.Read(ref s.CloudBytes));
        w.WriteNumber("ms", s.Clock.ElapsedMilliseconds);
        w.WriteString("current", s.Current);
        if (state == "error") w.WriteString("error", s.Error);
        if (state == "done" && !s.Counted)
        {
            s.Counted = true;
            _profile.Bump("scans", 1, false);
            _profile.Bump("scannedBytes", s.Root!.Size, false);
            _profile.Bump("biggestScan", s.Root!.Size, true);
        }
        if (state == "done")
        {
            w.WritePropertyName("profile");
            WriteProfileObject(w);
        }
        w.WriteEndObject();
    }

    // ---------------------------------------------------------------- reading the tree

    Scan Done()
    {
        var s = _scan;
        if (s == null || s.State != "done") throw new InvalidOperationException("No finished scan.");
        return s;
    }

    Node Get(int id)
    {
        var s = Done();
        if (id < 0 || id >= s.Nodes.Count || s.Nodes[id] is not { } n) throw new InvalidOperationException("That item is gone.");
        return n;
    }

    /// <summary>The treemap payload: a folder, a few levels deep, with tiny items rolled up.</summary>
    void View(int id, int depth, Utf8JsonWriter w)
    {
        var n = Get(id);
        if (!n.IsDir) n = n.Parent!;
        string path = Scan.PathOf(n);

        w.WriteStartObject();
        w.WriteString("path", path);
        w.WriteNumber("parent", n.Parent?.Id ?? -1);
        w.WriteBoolean("locked", n.Parent == null || Guard.IsProtected(path, out _));
        w.WriteStartArray("crumbs");
        var chain = new List<Node>();
        for (var c = n; c != null; c = c.Parent) chain.Add(c);
        for (int i = chain.Count - 1; i >= 0; i--)
        {
            w.WriteStartObject();
            w.WriteNumber("id", chain[i].Id);
            w.WriteString("name", chain[i].Name);
            w.WriteEndObject();
        }
        w.WriteEndArray();
        w.WritePropertyName("tree");
        WriteTree(w, n, depth, Math.Max(1, n.Size / 2500));
        w.WriteEndObject();
    }

    static void WriteTree(Utf8JsonWriter w, Node n, int depth, long minSize)
    {
        w.WriteStartObject();
        w.WriteNumber("id", n.Id);
        w.WriteString("name", n.Name);
        w.WriteNumber("size", n.Size);
        w.WriteNumber("cat", n.Cat);
        if (n.IsDir)
        {
            w.WriteBoolean("dir", true);
            w.WriteNumber("files", n.Files);
            if (depth > 0)
            {
                int shown = 0;
                long shownSize = 0;
                w.WriteStartArray("kids");
                foreach (var c in n.Children!)
                {
                    if (c.Size < minSize || shown >= 120) break;   // children are sorted biggest-first
                    WriteTree(w, c, depth - 1, minSize);
                    shown++;
                    shownSize += c.Size;
                }
                w.WriteEndArray();
                if (shown < n.Children.Count)
                {
                    w.WriteNumber("restCount", n.Children.Count - shown);
                    w.WriteNumber("restSize", n.Size - shownSize);
                }
            }
        }
        w.WriteEndObject();
    }

    static void WriteItem(Utf8JsonWriter w, Node n, bool withLock = false)
    {
        w.WriteNumber("id", n.Id);
        w.WriteString("name", n.Name);
        w.WriteString("folder", n.Parent == null ? "" : Scan.PathOf(n.Parent));
        w.WriteNumber("pid", n.Parent?.Id ?? -1);
        w.WriteNumber("size", n.Size);
        w.WriteNumber("cat", n.Cat);
        w.WriteBoolean("dir", n.IsDir);
        w.WriteNumber("files", n.Files);
        w.WriteNumber("mod", (n.Modified - DateTime.UnixEpoch.Ticks) / TimeSpan.TicksPerMillisecond);
        w.WriteStartArray("chain");   // ids from the scan root down to this item
        var chain = new List<int>();
        for (var c = n; c != null; c = c.Parent) chain.Add(c.Id);
        for (int i = chain.Count - 1; i >= 0; i--) w.WriteNumberValue(chain[i]);
        w.WriteEndArray();
        if (withLock)
        {
            string why = "";
            bool locked = n.Parent == null || Guard.IsProtected(Scan.PathOf(n), out why);
            w.WriteBoolean("locked", locked);
            if (locked) w.WriteString("why", n.Parent == null ? "This is the folder you scanned." : why);
        }
    }

    /// <summary>Largest files anywhere under a folder.</summary>
    void Top(int id, int count, Utf8JsonWriter w)
    {
        var n = Get(id);
        var heap = new PriorityQueue<Node, long>();
        if (n.IsDir) Collect(n, heap, count);
        var list = new List<Node>(heap.Count);
        while (heap.Count > 0) list.Add(heap.Dequeue());
        list.Reverse();

        w.WriteStartArray();
        foreach (var f in list)
        {
            w.WriteStartObject();
            WriteItem(w, f);
            w.WriteEndObject();
        }
        w.WriteEndArray();

        static void Collect(Node dir, PriorityQueue<Node, long> heap, int cap)
        {
            foreach (var c in dir.Children!)
            {
                if (heap.Count >= cap && c.Size <= heap.Peek().Size) break;   // sorted: nothing after this qualifies
                if (c.IsDir) Collect(c, heap, cap);
                else
                {
                    heap.Enqueue(c, c.Size);
                    if (heap.Count > cap) heap.Dequeue();
                }
            }
        }
    }

    void Types(int id, Utf8JsonWriter w)
    {
        var n = Get(id);
        var bytes = new long[Cats.Count];
        var files = new int[Cats.Count];
        Walk(n);
        w.WriteStartArray();
        for (int i = 0; i < Cats.Count; i++)
        {
            w.WriteStartObject();
            w.WriteNumber("cat", i);
            w.WriteNumber("size", bytes[i]);
            w.WriteNumber("files", files[i]);
            w.WriteEndObject();
        }
        w.WriteEndArray();

        void Walk(Node x)
        {
            if (x.Children == null) { bytes[x.Cat] += x.Size; files[x.Cat]++; return; }
            foreach (var c in x.Children) Walk(c);
        }
    }

    // ---------------------------------------------------------------- quests

    const long MB = 1024 * 1024;
    static readonly HashSet<string> DevDirs = new(StringComparer.OrdinalIgnoreCase)
        { "node_modules", ".venv", "venv", "__pycache__", ".gradle", ".tox", ".pytest_cache", ".next", ".parcel-cache" };
    static readonly HashSet<string> TempDirs = new(StringComparer.OrdinalIgnoreCase) { "Temp", "tmp", "CrashDumps" };
    static readonly HashSet<string> InstallerExts = new(StringComparer.OrdinalIgnoreCase)
        { ".exe", ".msi", ".msix", ".iso", ".zip", ".7z", ".rar" };

    sealed class Quest(string key)
    {
        public readonly string Key = key;
        public long Total;
        public int Count;
        readonly PriorityQueue<Node, long> _top = new();
        public void Add(Node n, long worth = -1)
        {
            Total += worth < 0 ? n.Size : worth;
            Count++;
            _top.Enqueue(n, n.Size);
            if (_top.Count > 25) _top.Dequeue();
        }
        public List<Node> Items()
        {
            var list = new List<Node>();
            while (_top.Count > 0) list.Add(_top.Dequeue());
            list.Reverse();
            return list;
        }
    }

    /// <summary>Scans the tree for the usual space-wasters and returns them as "quests".</summary>
    void Quests(Utf8JsonWriter w)
    {
        var s = Done();
        long oldBefore = DateTime.UtcNow.AddYears(-1).Ticks;
        var old = new Quest("old");
        var installers = new Quest("installers");
        var dev = new Quest("dev");
        var temp = new Quest("temp");
        var twins = new Quest("twins");
        var bySizeName = new Dictionary<(long, string), List<Node>>();

        // System areas are off-limits for clean-up, so quests never look inside them.
        var skip = new HashSet<Node>();
        foreach (var tree in Guard.Trees)
            if (Find(s, tree) is { } n) skip.Add(n);

        Walk(s.Root!, false);

        foreach (var group in bySizeName.Values)
        {
            if (group.Count < 2) continue;
            foreach (var n in group) twins.Add(n, 0);
            twins.Total += group[0].Size * (group.Count - 1);
        }

        w.WriteStartArray();
        foreach (var q in new[] { old, installers, dev, temp, twins })
        {
            w.WriteStartObject();
            w.WriteString("key", q.Key);
            w.WriteNumber("total", q.Total);
            w.WriteNumber("count", q.Count);
            w.WriteStartArray("items");
            foreach (var n in q.Items())
            {
                w.WriteStartObject();
                WriteItem(w, n);
                w.WriteEndObject();
            }
            w.WriteEndArray();
            w.WriteEndObject();
        }
        w.WriteEndArray();

        void Walk(Node dir, bool inDownloads)
        {
            foreach (var c in dir.Children!)
            {
                if (c.IsDir)
                {
                    if (skip.Contains(c) || c.Size == 0) continue;
                    if (DevDirs.Contains(c.Name))
                    {
                        if (c.Size >= 20 * MB) dev.Add(c);
                        continue;
                    }
                    if (TempDirs.Contains(c.Name))
                    {
                        foreach (var t in c.Children!)
                            if (t.Size >= 10 * MB) temp.Add(t);
                        continue;
                    }
                    Walk(c, inDownloads || c.Name.Equals("Downloads", StringComparison.OrdinalIgnoreCase));
                }
                else
                {
                    if (c.Size >= 100 * MB && c.Modified < oldBefore) old.Add(c);
                    if (inDownloads && c.Size >= 20 * MB && InstallerExts.Contains(Path.GetExtension(c.Name))) installers.Add(c);
                    if (c.Size >= 50 * MB)
                    {
                        var key = (c.Size, c.Name.ToLowerInvariant());
                        if (!bySizeName.TryGetValue(key, out var list)) bySizeName[key] = list = new List<Node>();
                        list.Add(c);
                    }
                }
            }
        }
    }

    static Node? Find(Scan s, string path)
    {
        string root = s.RootPath.TrimEnd('\\');
        if (!path.StartsWith(root + "\\", StringComparison.OrdinalIgnoreCase)) return null;
        var node = s.Root!;
        foreach (var part in path[(root.Length + 1)..].Split('\\', StringSplitOptions.RemoveEmptyEntries))
        {
            var next = node.Children?.Find(c => c.IsDir && c.Name.Equals(part, StringComparison.OrdinalIgnoreCase));
            if (next == null) return null;
            node = next;
        }
        return node;
    }

    // ---------------------------------------------------------------- actions

    /// <summary>Sends items to the Recycle Bin (never a permanent delete) and updates the tree.</summary>
    void Trash(JsonElement a, Utf8JsonWriter w)
    {
        var s = Done();
        var results = new List<(int Id, string? Error)>();
        long freed = 0, biggest = 0;
        int count = 0;

        foreach (var idElement in a.GetProperty("ids").EnumerateArray())
        {
            int id = idElement.GetInt32();
            if (id < 0 || id >= s.Nodes.Count || s.Nodes[id] is not { } n)
            {
                results.Add((id, null));   // already removed along with a parent folder
                continue;
            }

            string path = Scan.PathOf(n);
            string? error = null;
            if (n.Parent == null) error = "This is the folder you scanned.";
            else if (Guard.IsProtected(path, out var why)) error = why;
            else if (!File.Exists(path) && !Directory.Exists(path))
            {
                s.Detach(n);               // deleted outside the app: just forget it
                results.Add((id, null));
                continue;
            }
            else
            {
                try
                {
                    // AllDialogs: Windows asks before anything that is too big for the Recycle Bin
                    // would be deleted for good, instead of doing it silently.
                    _onUiThread(() =>
                    {
                        if (n.IsDir)
                            FileSystem.DeleteDirectory(path, UIOption.AllDialogs, RecycleOption.SendToRecycleBin, UICancelOption.ThrowException);
                        else
                            FileSystem.DeleteFile(path, UIOption.AllDialogs, RecycleOption.SendToRecycleBin, UICancelOption.ThrowException);
                        return null;
                    });
                }
                catch (OperationCanceledException) { error = "Cancelled."; }
                catch (Exception ex) { error = ex.Message; }

                if (error == null && (File.Exists(path) || Directory.Exists(path)))
                    error = "Windows could not remove it (in use, or access denied).";
            }

            if (error == null)
            {
                freed += n.Size;
                biggest = Math.Max(biggest, n.Size);
                count++;
                s.Detach(n);
            }
            results.Add((id, error));
        }

        if (count > 0)
        {
            _profile.Bump("freedBytes", freed, false);
            _profile.Bump("itemsTrashed", count, false);
            _profile.Bump("biggestTrash", biggest, true);
            _profile.Bump("biggestHaul", freed, true);
        }

        w.WriteStartObject();
        w.WriteNumber("freed", freed);
        w.WriteNumber("count", count);
        w.WriteStartArray("results");
        foreach (var r in results)
        {
            w.WriteStartObject();
            w.WriteNumber("id", r.Id);
            if (r.Error != null) w.WriteString("error", r.Error);
            w.WriteEndObject();
        }
        w.WriteEndArray();
        w.WritePropertyName("profile");
        WriteProfileObject(w);
        w.WriteEndObject();
    }

    static void Reveal(Node n)
    {
        string path = Scan.PathOf(n);
        if (File.Exists(path) || Directory.Exists(path))
            Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{path}\"") { UseShellExecute = false });
    }

    // ---------------------------------------------------------------- helpers

    void WriteProfileObject(Utf8JsonWriter w)
    {
        w.WriteStartObject();
        foreach (var kv in _profile.Snapshot()) w.WriteNumber(kv.Key, kv.Value);
        w.WriteEndObject();
    }

    static void Empty(Utf8JsonWriter w) { w.WriteStartObject(); w.WriteEndObject(); }

    static bool Prop(JsonElement a, string key, out JsonElement value)
    {
        value = default;
        return a.ValueKind == JsonValueKind.Object && a.TryGetProperty(key, out value);
    }
    static int Int(JsonElement a, string key, int fallback = 0) =>
        Prop(a, key, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt32() : fallback;
    static double Num(JsonElement a, string key) =>
        Prop(a, key, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : 0;
    static string Str(JsonElement a, string key) =>
        Prop(a, key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
}

/// <summary>Decides what the app refuses to delete, however nicely it is asked.</summary>
static class Guard
{
    /// <summary>Folders whose whole contents are off-limits.</summary>
    public static readonly string[] Trees = new[]
    {
        Environment.GetFolderPath(Environment.SpecialFolder.Windows),
        Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
        Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
    }.Where(p => p.Length > 0).Select(Trim).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();

    /// <summary>Folders that must stay, although what is inside them is fair game.</summary>
    static readonly string[] Exact = BuildExact();

    static readonly HashSet<string> RootNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "pagefile.sys", "hiberfil.sys", "swapfile.sys", "System Volume Information", "$Recycle.Bin",
        "Recovery", "$WinREAgent", "bootmgr", "BOOTNXT", "DumpStack.log.tmp", "Documents and Settings",
    };

    static string Trim(string p) => p.TrimEnd('\\');

    static string[] BuildExact()
    {
        var list = new List<string>();
        void Add(string p) { if (!string.IsNullOrEmpty(p)) list.Add(Trim(p)); }
        string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        Add(home);
        Add(Path.Combine(home, "Downloads"));
        Add(Path.Combine(home, "AppData"));
        Add(Path.Combine(home, "OneDrive"));
        foreach (var f in new[]
        {
            Environment.SpecialFolder.DesktopDirectory, Environment.SpecialFolder.MyDocuments,
            Environment.SpecialFolder.MyPictures, Environment.SpecialFolder.MyMusic, Environment.SpecialFolder.MyVideos,
            Environment.SpecialFolder.ApplicationData, Environment.SpecialFolder.LocalApplicationData,
        }) Add(Environment.GetFolderPath(f));
        if (Environment.ProcessPath is { } exe) Add(exe);
        Add(Profile.DataDir);
        return list.Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
    }

    public static bool IsProtected(string path, out string why)
    {
        path = Trim(path);
        string prefix = path + "\\";
        why = "";

        if (path.Length <= 2 || Path.GetPathRoot(prefix)?.Length >= prefix.Length)
            return Fail(out why, "A whole drive can't go in the bin.");

        foreach (var tree in Trees)
        {
            if (path.Equals(tree, StringComparison.OrdinalIgnoreCase) || path.StartsWith(tree + "\\", StringComparison.OrdinalIgnoreCase))
                return Fail(out why, "System area. Uninstall apps and games from Windows Settings or their launcher instead.");
            if (tree.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                return Fail(out why, "This folder contains Windows or installed programs.");
        }

        foreach (var keep in Exact)
        {
            if (path.Equals(keep, StringComparison.OrdinalIgnoreCase))
                return Fail(out why, "Windows needs this folder. Clear out what's inside it instead.");
            if (keep.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                return Fail(out why, "This folder contains your profile or app folders.");
        }

        string parent = Path.GetDirectoryName(path) ?? "";
        if (Path.GetPathRoot(parent) == parent && RootNames.Contains(Path.GetFileName(path)))
            return Fail(out why, "Windows system file.");

        string users = Path.GetDirectoryName(Trim(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile))) ?? "";
        if (users.Length > 0 && (path.Equals(users, StringComparison.OrdinalIgnoreCase) || parent.Equals(users, StringComparison.OrdinalIgnoreCase)))
            return Fail(out why, "User profile folder.");

        return false;

        static bool Fail(out string why, string reason) { why = reason; return true; }
    }
}

/// <summary>The player's lifetime stats, saved as a small JSON file in %LocalAppData%\DiskDive.</summary>
sealed class Profile
{
    public static readonly string DataDir =
        Environment.GetEnvironmentVariable("DISKDIVE_DATA") is { Length: > 0 } custom
            ? custom
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DiskDive");

    readonly string _file = Path.Combine(DataDir, "profile.json");
    readonly Dictionary<string, double> _values = new();

    public Profile()
    {
        try
        {
            if (File.Exists(_file))
                _values = JsonSerializer.Deserialize<Dictionary<string, double>>(File.ReadAllText(_file)) ?? new();
        }
        catch { /* corrupt profile: start fresh */ }
    }

    public void Bump(string key, double value, bool max)
    {
        if (key.Length is 0 or > 40 || !double.IsFinite(value)) return;
        lock (_values)
        {
            _values.TryGetValue(key, out var current);
            double next = max ? Math.Max(current, value) : current + value;
            if (next == current && _values.ContainsKey(key)) return;
            _values[key] = next;
            try
            {
                Directory.CreateDirectory(DataDir);
                File.WriteAllText(_file, JsonSerializer.Serialize(_values));
            }
            catch { /* stats are nice-to-have */ }
        }
    }

    public Dictionary<string, double> Snapshot()
    {
        lock (_values) return new Dictionary<string, double>(_values);
    }
}
