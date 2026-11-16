# Builds the single-file DiskQuest.exe into .\dist  (needs the .NET 9 SDK).
$ErrorActionPreference = 'Stop'
dotnet publish "$PSScriptRoot\DiskQuest\DiskQuest.csproj" -c Release -r win-x64 --self-contained true `
    -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true `
    -o "$PSScriptRoot\dist" --nologo
Get-Item "$PSScriptRoot\dist\DiskQuest.exe" | ForEach-Object { "{0}  {1:N1} MB" -f $_.FullName, ($_.Length / 1MB) }
Remove-Item "$PSScriptRoot\dist\*.xml" -ErrorAction SilentlyContinue
