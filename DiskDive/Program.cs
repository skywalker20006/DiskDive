using System.Net;
using System.Reflection;

namespace DiskDive;

static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        // Developer-only switches:  --dev <port>  serves the UI + API on 127.0.0.1 so it can be
        // opened in a normal browser;  --ui-dir <path>  loads UI files from disk instead of the exe.
        int devPort = 0;
        string? uiDir = null;
        for (int i = 0; i < args.Length - 1; i++)
        {
            if (args[i] == "--dev") int.TryParse(args[i + 1], out devPort);
            if (args[i] == "--ui-dir") uiDir = args[i + 1];
        }

        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm(devPort, uiDir));
    }
}

/// <summary>UI files (HTML/CSS/JS) are embedded in the exe so the app ships as one file.</summary>
static class Assets
{
    public static (byte[] Data, string Mime)? Get(string name, string? uiDir)
    {
        if (name.Length == 0 || name.Any(c => !(char.IsAsciiLetterOrDigit(c) || c is '.' or '-' or '_'))) return null;
        byte[]? data = null;
        if (uiDir != null)
        {
            var file = Path.Combine(uiDir, name);
            if (File.Exists(file)) data = File.ReadAllBytes(file);
        }
        else
        {
            using var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("ui/" + name);
            if (s != null)
            {
                using var ms = new MemoryStream();
                s.CopyTo(ms);
                data = ms.ToArray();
            }
        }
        if (data == null) return null;
        string mime = Path.GetExtension(name).ToLowerInvariant() switch
        {
            ".html" => "text/html; charset=utf-8",
            ".css" => "text/css; charset=utf-8",
            ".js" => "text/javascript; charset=utf-8",
            ".svg" => "image/svg+xml",
            ".png" => "image/png",
            _ => "application/octet-stream",
        };
        return (data, mime);
    }
}

/// <summary>Loopback-only HTTP bridge used during development (never started in normal use).</summary>
static class DevServer
{
    public static void Start(int port, Api api, string? uiDir)
    {
        var listener = new HttpListener();
        listener.Prefixes.Add($"http://127.0.0.1:{port}/");
        listener.Start();
        Task.Run(async () =>
        {
            while (true)
            {
                var ctx = await listener.GetContextAsync();
                _ = Task.Run(() => Serve(ctx, api, uiDir));
            }
        });
    }

    static void Serve(HttpListenerContext ctx, Api api, string? uiDir)
    {
        try
        {
            var req = ctx.Request;
            var res = ctx.Response;
            byte[] body;
            if (req.HttpMethod == "POST" && req.Url!.AbsolutePath == "/api")
            {
                // A custom header forces a CORS preflight, so other web pages cannot call this.
                if (req.Headers["X-DQ"] != "1") { res.StatusCode = 403; res.Close(); return; }
                using var reader = new StreamReader(req.InputStream, req.ContentEncoding);
                body = System.Text.Encoding.UTF8.GetBytes(api.Handle(reader.ReadToEnd()));
                res.ContentType = "application/json; charset=utf-8";
            }
            else
            {
                var name = req.Url!.AbsolutePath.TrimStart('/');
                var asset = Assets.Get(name.Length == 0 ? "index.html" : name, uiDir);
                if (asset == null) { res.StatusCode = 404; res.Close(); return; }
                body = asset.Value.Data;
                res.ContentType = asset.Value.Mime;
                res.Headers["Cache-Control"] = "no-store";
            }
            res.ContentLength64 = body.Length;
            res.OutputStream.Write(body);
            res.Close();
        }
        catch { /* client went away */ }
    }
}
