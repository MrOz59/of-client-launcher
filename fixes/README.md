# Game fixes

One JSON per fix. The launcher reads `index.json` to see what exists for a game
and downloads the fix itself only when someone asks for it.

`index.json` is generated — do not edit it by hand:

```bash
npm run fixes:index    # validate every fix and rewrite the index
npm run fixes:check    # validate without writing (what CI runs)
```

## What a fix may contain

```jsonc
{
  "kind": "voidlauncher.gameFix",
  "schemaVersion": 1,
  "id": "subnautica-nitrox",          // must equal the file name
  "title": "Subnautica + Nitrox (multiplayer)",
  "description": "What it fixes, and why the game fails without it.",
  "game": { "id": "18121", "title": "Subnautica", "url": "https://…" },

  "proton": {
    "runtimeName": "Proton-GE Latest", // matched by name against installed runtimes
    "options": {},                     // empty means the launcher defaults
    "steamAppId": "264710"
  },

  "components": { "winetricks": ["dotnetdesktop9"] },

  // The binary to launch, when the game's mod ships its own launcher.
  // A bare file name: it selects among the executables already in the folder.
  "launchExecutable": "Nitrox.Launcher.exe",

  // Assemblies to take from the Proton runtime's wine-mono and place in the
  // game folder, for a facade the game does not ship and a mod needs.
  "runtimeAssemblies": [
    { "name": "System.Net.Primitives.dll", "into": "Nitrox/lib/net472" }
  ],

  "notes": ["Anything the person applying it should know."]
}
```

## What a fix may never contain

A fix is a file that travels between machines, so it carries no payload and no
URL. It can only name something the Proton runtime already ships, and a folder
inside the game's own directory. Destinations that climb out with `..`, names
carrying a path, and anything that is not a plain `.dll` or `.exe` name are
rejected — by the validator here, and again by the launcher on arrival.

Nothing here can add a file the launcher did not already have on disk.

## Adding one

1. Write `fixes/<id>.json`.
2. Run `npm run fixes:index`.
3. Commit both files.

Say in `notes` what actually goes wrong without the fix. A fix that lists
settings without explaining the failure is hard for the next person to trust.
