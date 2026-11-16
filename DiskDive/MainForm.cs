using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace DiskDive;

/// <summary>The app window: a WebView2 surface showing the embedded UI, wired to <see cref="Api"/>.</summary>
sealed class MainForm : Form
{
    const string Origin = "https://diskdive.example/";

    readonly WebView2 _web = new() { Dock = DockStyle.Fill };
    readonly Api _api;
    readonly string? _uiDir;

    public MainForm(int devPort, string? uiDir)
    {
        _uiDir = uiDir;
        Text = "DiskDive";
        ClientSize = new Size(1320, 840);
        MinimumSize = new Size(980, 640);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(14, 16, 27);
        using (var ico = Assembly.GetExecutingAssembly().GetManifestResourceStream("app.ico"))
            if (ico != null) Icon = new Icon(ico);

        _web.DefaultBackgroundColor = BackColor;
        Controls.Add(_web);

        _api = new Api(f => Invoke(f));
        if (devPort > 0) DevServer.Start(devPort, _api, uiDir);

        Load += async (_, _) => await InitAsync();
        FormClosing += (_, _) => _api.Shutdown();
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        int on = 1;   // dark title bar
        DwmSetWindowAttribute(Handle, 20, ref on, sizeof(int));
    }

    async Task InitAsync()
    {
        try
        {
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Profile.DataDir, "WebView2"));
            await _web.EnsureCoreWebView2Async(env);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this,
                "DiskDive needs the Microsoft Edge WebView2 Runtime, which is missing or broken on this PC.\n\n" +
                "Install it from:\nhttps://go.microsoft.com/fwlink/p/?LinkId=2124703\n\nDetails: " + ex.Message,
                "DiskDive", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
            return;
        }

        var core = _web.CoreWebView2;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;
#if !DEBUG
        core.Settings.AreDevToolsEnabled = false;
#endif

        // Serve the embedded UI for our private origin; nothing is ever fetched from the network.
        core.AddWebResourceRequestedFilter(Origin + "*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += (_, e) =>
        {
            var name = new Uri(e.Request.Uri).AbsolutePath.TrimStart('/');
            var asset = Assets.Get(name.Length == 0 ? "index.html" : name, _uiDir);
            e.Response = asset == null
                ? core.Environment.CreateWebResourceResponse(null, 404, "Not Found", "")
                : core.Environment.CreateWebResourceResponse(new MemoryStream(asset.Value.Data), 200, "OK",
                    $"Content-Type: {asset.Value.Mime}\nCache-Control: no-store");
        };
        core.NavigationStarting += (_, e) =>
        {
            if (!e.Uri.StartsWith(Origin, StringComparison.OrdinalIgnoreCase)) e.Cancel = true;
        };
        core.NewWindowRequested += (_, e) => e.Handled = true;

        core.WebMessageReceived += (_, e) =>
        {
            string request = e.WebMessageAsJson;
            Task.Run(() =>
            {
                string response = _api.Handle(request);
                try { BeginInvoke(() => core.PostWebMessageAsJson(response)); }
                catch (InvalidOperationException) { /* window closed */ }
            });
        };

        core.Navigate(Origin + "index.html");
    }

    [DllImport("dwmapi.dll")]
    static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
}
