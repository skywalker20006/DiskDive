# DiskQuest

**See what's eating your disk, then get rewarded for clearing it out.**

DiskQuest is a free Windows app that scans a drive or folder and draws it as an interactive map: every file is a block, the bigger the block the more space it takes, and the colour tells you what kind of file it is. Click a folder to dive in, bag the things you don't want, and send them to the Recycle Bin for XP.

<!-- Add a screenshot here once you have one:  ![DiskQuest](docs/screenshot.png) -->

## Download

Grab `DiskQuest.exe` from the [latest release](../../releases/latest) and run it. There is nothing to install.

- Windows 10 or 11, 64-bit.
- The first time you run it, Windows SmartScreen may say "Windows protected your PC" because the app isn't code-signed. Choose **More info**, then **Run anyway**.
- It uses the Microsoft Edge WebView2 Runtime, which is already part of Windows 11 and most Windows 10 PCs. If it's missing, the app tells you where to get it.

## What it does

- **Interactive map.** A treemap of the whole drive. Click any folder to zoom into it, right-click (or Backspace) to climb back out, scroll to dive towards the cursor.
- **Space hogs.** A ranked list of the biggest files under whatever folder you're looking at. Hover a row and it lights up on the map.
- **Quests.** After each scan DiskQuest points out the easy wins: big files untouched for a year, installers left in Downloads, `node_modules` and other dev leftovers, temp piles, and likely duplicate files.
- **Types.** A breakdown of the folder by file type. Hover a type to spotlight it on the map.
- **The bag.** Collect things you want gone, review the list, then recycle them in one go.
- **Levels and trophies.** Every megabyte you reclaim earns XP. Twelve trophies to unlock, from *First Expedition* to *Hundred-Gig Hero*.
- **Fast.** The scanner runs in parallel; a drive with 1.3 million files maps in well under a minute on an SSD.

## Safety

- DiskQuest never deletes anything for good. Clean-ups go to the **Recycle Bin**, so you can restore them.
- Windows, Program Files, ProgramData and your core profile folders are locked and cannot be bagged.
- Nothing leaves your PC. The app makes no network requests and has no telemetry.
- Online-only cloud files (OneDrive placeholders) are skipped because they take no disk space.

Your level and stats are stored in `%LocalAppData%\DiskQuest\profile.json`. Delete that folder to reset them.

## Build from source

You need the [.NET 9 SDK](https://dotnet.microsoft.com/download).

```powershell
./build.ps1
```

That produces a self-contained `dist\DiskQuest.exe`. To run it straight from source instead:

```powershell
dotnet run --project DiskQuest
```

### Project layout

| Path | What's in it |
|---|---|
| `DiskQuest/Scanner.cs` | Parallel disk scanner and the in-memory file tree |
| `DiskQuest/Api.cs` | Commands the UI can call, the Recycle Bin logic, and the guard list of protected folders |
| `DiskQuest/MainForm.cs` | The window (WinForms + WebView2) |
| `DiskQuest/ui/` | The interface: plain HTML, CSS and JavaScript, embedded into the exe |
| `tools/make-icon.ps1` | Regenerates the app icon |

For UI work, `DiskQuest.exe --dev 5199 --ui-dir DiskQuest\ui` also serves the interface at `http://127.0.0.1:5199`, so you can open it in a browser with dev tools and edit the UI files without rebuilding.

## Publishing a release

Push a version tag and GitHub Actions builds the exe and attaches it to a new release:

```powershell
git tag v1.0.0
git push origin v1.0.0
```

## Licence

MIT. See [LICENSE](LICENSE).
