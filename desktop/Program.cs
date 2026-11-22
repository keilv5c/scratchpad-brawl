using System.Diagnostics;
using System.IO.Compression;
using System.Net.Http;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace InkbladeDesktop;

internal sealed class VersionInfo
{
    public string version { get; set; } = "0.1.0";
    public string buildTime { get; set; } = "";
    public string notes { get; set; } = "";
}

internal sealed class UpdateConfig
{
    public string manifestUrl { get; set; } = "";
    public string packageUrl { get; set; } = "";
    public string localZipPath { get; set; } = "";
}

internal sealed class MainForm : Form
{
    private readonly WebView2 _webView;
    private readonly string _baseDir;
    private readonly string _appDir;
    private readonly string _userDataDir;
    private bool _isFullscreen;
    private FormWindowState _prevWindowState;
    private FormBorderStyle _prevBorderStyle;
    private Rectangle _prevBounds;

    public MainForm()
    {
        _baseDir = AppContext.BaseDirectory;
        _appDir = Path.Combine(_baseDir, "app");
        _userDataDir = Path.Combine(_baseDir, "userdata");

        Text = BuildWindowTitle();
        Width = 1300;
        Height = 768;
        MinimumSize = new Size(960, 560);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(27, 24, 20);
        KeyPreview = true;

        var icoPath = Path.Combine(_baseDir, "app.ico");
        if (File.Exists(icoPath))
        {
            Icon = new Icon(icoPath);
        }

        _webView = new WebView2
        {
            Dock = DockStyle.Fill,
            DefaultBackgroundColor = Color.FromArgb(27, 24, 20)
        };
        Controls.Add(_webView);

        Load += async (_, _) => await InitWebViewAsync();
    }

    private string ReadCurrentVersion()
    {
        try
        {
            var vFile = Path.Combine(_appDir, "version.json");
            if (File.Exists(vFile))
            {
                var info = JsonSerializer.Deserialize<VersionInfo>(File.ReadAllText(vFile));
                if (!string.IsNullOrWhiteSpace(info?.version))
                    return info.version;
            }
        }
        catch { }
        return "0.3.3";
    }

    private string BuildWindowTitle()
    {
        return $"草稿纸大乱斗 v{ReadCurrentVersion()}  [F11 全屏 | F5 热重载 | F9 检查更新]";
    }

    private async Task InitWebViewAsync()
    {
        if (!Directory.Exists(_appDir) || !File.Exists(Path.Combine(_appDir, "index.html")))
        {
            MessageBox.Show(
                $"未找到游戏资源目录：\n{_appDir}\n\n请先运行「更新游戏到EXE.bat」生成最新游戏文件。",
                "草稿纸大乱斗",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning
            );
            return;
        }

        Directory.CreateDirectory(_userDataDir);

        var env = await CoreWebView2Environment.CreateAsync(null, _userDataDir);
        await _webView.EnsureCoreWebView2Async(env);

        var core = _webView.CoreWebView2;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;
        core.Settings.AreDevToolsEnabled = true;

        // Map local app/ folder to a virtual HTTPS host so ES modules, Web Audio & localStorage work seamlessly!
        core.SetVirtualHostNameToFolderMapping(
            "inkblade.local",
            _appDir,
            CoreWebView2HostResourceAccessKind.Allow
        );

        // Allow in-game UI buttons ("⛶ 全屏") to toggle native borderless fullscreen!
        core.WebMessageReceived += (_, e) =>
        {
            var msg = e.TryGetWebMessageAsString();
            if (msg == "toggle-fullscreen")
            {
                BeginInvoke(ToggleFullscreen);
            }
        };

        // Allow native keyboard shortcuts even while WebView2 has focus
        _webView.KeyDown += async (_, e) =>
        {
            if (e.KeyCode == Keys.F11)
            {
                e.Handled = true;
                ToggleFullscreen();
            }
            else if (e.KeyCode == Keys.F5)
            {
                e.Handled = true;
                Text = BuildWindowTitle();
                core.Reload();
            }
            else if (e.KeyCode == Keys.F9)
            {
                e.Handled = true;
                await CheckAndApplyUpdateAsync();
            }
        };

        core.Navigate("https://inkblade.local/index.html");
    }

    private void ToggleFullscreen()
    {
        if (!_isFullscreen)
        {
            _prevWindowState = WindowState;
            _prevBorderStyle = FormBorderStyle;
            _prevBounds = Bounds;
            WindowState = FormWindowState.Normal;
            FormBorderStyle = FormBorderStyle.None;
            Bounds = Screen.FromControl(this).Bounds;
            _isFullscreen = true;
        }
        else
        {
            FormBorderStyle = _prevBorderStyle;
            Bounds = _prevBounds;
            WindowState = _prevWindowState;
            _isFullscreen = false;
        }
    }

    private async Task CheckAndApplyUpdateAsync()
    {
        var cfgPath = Path.Combine(_baseDir, "update-config.json");
        if (!File.Exists(cfgPath))
        {
            MessageBox.Show(
                "未配置远程更新源（update-config.json）。\n\n本地随时更新方式：\n1. 双击项目根目录的「更新游戏到EXE.bat」\n2. 回到本窗口按 F5 即可热重载最新内容！\n\n若需远程自动拉取，可在 release/update-config.json 中填写 manifestUrl 与 packageUrl。",
                "热更新提示",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information
            );
            return;
        }

        try
        {
            var cfg = JsonSerializer.Deserialize<UpdateConfig>(File.ReadAllText(cfgPath));
            if (cfg == null) return;

            // Support local zip update drop-in OR HTTP remote package update!
            if (!string.IsNullOrWhiteSpace(cfg.localZipPath) && File.Exists(cfg.localZipPath))
            {
                ApplyZipUpdate(cfg.localZipPath);
                return;
            }

            if (string.IsNullOrWhiteSpace(cfg.manifestUrl) || string.IsNullOrWhiteSpace(cfg.packageUrl))
            {
                MessageBox.Show(
                    "update-config.json 中尚未设置更新地址。\n\n你也可以随时直接运行「更新游戏到EXE.bat」，然后在本窗口按 F5 秒级热更新！",
                    "草稿纸大乱斗 · 热更新",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information
                );
                return;
            }

            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
            var manifestJson = await http.GetStringAsync(cfg.manifestUrl);
            var remote = JsonSerializer.Deserialize<VersionInfo>(manifestJson);
            var localVer = ReadCurrentVersion();

            if (remote == null || remote.version == localVer)
            {
                MessageBox.Show($"当前已是最新版本 v{localVer}！", "检查更新", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            var ans = MessageBox.Show(
                $"发现新版本 v{remote.version}（当前 v{localVer}）\n{remote.notes}\n\n是否自动备份旧版并立即热更新？",
                "发现新版本",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question
            );
            if (ans != DialogResult.Yes) return;

            var tmpZip = Path.Combine(Path.GetTempPath(), $"inkblade_update_{DateTime.Now:yyyyMMddHHmmss}.zip");
            var bytes = await http.GetByteArrayAsync(cfg.packageUrl);
            await File.WriteAllBytesAsync(tmpZip, bytes);
            ApplyZipUpdate(tmpZip);
            File.Delete(tmpZip);
        }
        catch (Exception ex)
        {
            MessageBox.Show($"更新检查失败：{ex.Message}", "更新失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void ApplyZipUpdate(string zipPath)
    {
        var backupRoot = Path.Combine(_baseDir, "backups");
        Directory.CreateDirectory(backupRoot);
        var backupDir = Path.Combine(backupRoot, $"app_backup_{DateTime.Now:yyyyMMdd_HHmmss}");
        CopyDirectory(_appDir, backupDir);

        var tempExtract = Path.Combine(Path.GetTempPath(), $"inkblade_extract_{Guid.NewGuid():N}");
        ZipFile.ExtractToDirectory(zipPath, tempExtract, true);

        // Replace app/ contents cleanly
        foreach (var file in Directory.GetFiles(_appDir)) File.Delete(file);
        foreach (var dir in Directory.GetDirectories(_appDir)) Directory.Delete(dir, true);
        CopyDirectory(tempExtract, _appDir);
        Directory.Delete(tempExtract, true);

        Text = BuildWindowTitle();
        _webView.CoreWebView2?.Reload();
        MessageBox.Show($"热更新完成！已自动备份旧版至 backups 目录，当前版本 v{ReadCurrentVersion()}。", "更新成功", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    private static void CopyDirectory(string src, string dst)
    {
        Directory.CreateDirectory(dst);
        foreach (var f in Directory.GetFiles(src))
        {
            File.Copy(f, Path.Combine(dst, Path.GetFileName(f)), true);
        }
        foreach (var d in Directory.GetDirectories(src))
        {
            CopyDirectory(d, Path.Combine(dst, Path.GetFileName(d)));
        }
    }
}

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
    }
}
