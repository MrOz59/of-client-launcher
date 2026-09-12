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

  // Which systems this fix is for. Leave it out to mean both.
  "os": ["linux", "windows"],

  "proton": {
    "runtimeName": "Proton-GE Latest", // matched by name against installed runtimes
    "options": {},                     // empty means the launcher defaults
    "steamAppId": "264710"
  },

  "components": { "winetricks": ["dotnetdesktop9"] },

  // The binary to launch, when the game's mod ships its own launcher.
  // A bare file name: it selects among the executables already in the folder.
  "launchExecutable": "Nitrox.Launcher.exe",

  // Values that belong to the person applying the fix, not to the fix. The
  // launcher asks for them and writes them where {{id}} appears above.
  "inputs": [
    {
      "id": "username",           // letters, digits and _; starts with a letter
      "label": "Your player name", // the question the dialog asks
      "description": "Has to differ from the other players'. No spaces.",
      "type": "text",             // text | ipv4 | number
      "default": "Player"         // what the field opens on
    }
  ],

  // An archive hosted elsewhere, pinned by checksum, that the launcher fetches
  // only after the person agrees to it. See "Files the fix cannot ship".
  "downloads": [ /* … */ ],

  // Assemblies to take from the Proton runtime's wine-mono and place in the
  // game folder, for a facade the game does not ship and a mod needs.
  "runtimeAssemblies": [
    { "name": "System.Net.Primitives.dll", "into": "Nitrox/lib/net472" }
  ],

  "notes": ["Anything the person applying it should know."]
}
```

## Values the fix cannot know

Some fixes are only half a fix on their own: a multiplayer mod may take the
player's name and this machine's address off the command line, and those differ
for every player. Declare them under `inputs` and write `{{id}}` where each one
goes:

```jsonc
"proton": {
  "options": { "launchArgs": "-peerIp {{peerIp}} -userId {{userId}} -username {{username}}" }
}
```

The launcher opens a dialog when the fix is applied, shows the arguments it is
about to write as they are typed, and only then changes anything. Re-applying
the fix later opens on the answers already in effect rather than on the
defaults here.

Placeholders work in `launchArgs`, `wineDllOverrides` and `locale`, and nowhere
else. The three types are all a value may be: `text` (no spaces, quotes or
backslashes, because the launcher splits the arguments on spaces), `ipv4` and
`number`. Declaring an input nobody uses, or using a placeholder nobody
declared, fails validation — half of that pair is always a mistake.

A fix with no `inputs` is applied the way it always was, without a dialog.

## Files the fix cannot ship

Some mods are the fix. Below Zero's multiplayer needs a patched
`Assembly-CSharp.dll` and a 46 MB folder in the prefix; a fix that only points
the launcher at the right executable leaves the game starting vanilla, and the
person reading the notes has to go and install all of it by hand.

A fix may point at an archive hosted elsewhere:

```jsonc
"downloads": [
  {
    "id": "bzmp-linux-1-0-3",
    "label": "Subnautica BZ Multiplayer — Linux patch 1.0.3 (Troplo)",
    "url": "https://github.com/…/Subnautica.BZMP.Linux.1.0.3.zip",
    "sha256": "d883891f0a0e4c18eb8773a4e1029bc1a2448f2fdf1188cd4bf75611c97e5a96",
    "size": 32461030,
    "install": [
      { "from": "Game Folder", "into": "game:" },
      { "from": ".botbenson", "into": "prefix:AppData/Roaming/.botbenson" }
    ]
  }
]
```

`from` is a folder inside the archive and `into` is where its **contents** go:
`game:` is the game's own directory, `prefix:` is the Windows user profile of
its Wine prefix (`drive_c/users/steamuser`), and nothing else is a destination.
A replaced file is copied into `_voidlauncher-backup/<fix id>/` first.

This is the only part of a fix that reaches outside the machine, so it is the
only part that has to be agreed to. The launcher shows the host, the size, the
checksum and the destination, and installs nothing until the person says yes to
that screen — with the option to apply the fix's settings and skip the download,
for someone who already has the files.

**A published fix must pin a `sha256`, and it is checked on arrival.** That is
what makes a URL reviewable: not "this host is fine" but "this exact file, the
one whoever reviews the pull request can fetch and hash themselves". A rolling
link that serves whatever is newest cannot be reviewed, and is rejected here.

Say plainly in `notes` whose files they are. The launcher tells the person the
file is third party and unverified beyond its checksum; the fix should not
pretend otherwise.

## Linux, Windows, or both

Fixes began as a Linux thing — Proton settings, winetricks verbs, assemblies out
of wine-mono — so the whole file was implicitly "what to do under Proton". Then a
fix had to install a mod, and the mod is the same mod on Windows: the same
archive, the same folders, the same launch arguments. Only the Proton half has
no meaning there.

So `os` says which systems a fix is for, and the launcher skips what does not
apply instead of pretending it worked:

| | Linux | Windows |
|---|---|---|
| `launchExecutable`, `inputs`, `launchArgs`, `steamAppId` | applied | applied |
| `downloads` | fetched | fetched |
| `proton.runtimeName` and the rest of `proton.options` | applied | skipped, and said so |
| `components.winetricks` | installed | skipped, and said so |
| `runtimeAssemblies` | copied from the runtime | skipped, and said so |

`prefix:` means the same thing on both — the Windows user profile the game sees.
On Linux that is the Proton prefix's `drive_c/users/steamuser`; on Windows it is
the real profile, so `prefix:AppData/Roaming/.botbenson` is `%AppData%\.botbenson`
there. One rule, both systems.

A download can name systems of its own (`"os": ["linux"]`) when the file itself
differs; without it, it follows the fix. A fix whose `os` does not include the
system it lands on refuses to apply, rather than applying half of itself.

Leaving `os` out is the common case and means both. Write it when a fix is
genuinely one-sided.

## What a fix may never contain

A fix carries no payload of its own: no file contents, no scripts, no commands.
Everything it can do is name something — a winetricks verb, an executable
already in the game's folder, an assembly the Proton runtime ships, an archive
identified by its checksum.

The destinations are bounded the same way everywhere: paths that climb out with
`..`, names carrying a path, absolute paths, drive letters, symlinks inside an
archive, and anything that is not a plain `.dll` or `.exe` name where a file
name is expected are rejected — by the validator here, and again by the launcher
on arrival. A download must be https, must carry no credentials in the URL, must
be a `.zip`, `.7z` or `.rar`, and must fit in 512 MB.

## Adding one

1. Write `fixes/<id>.json`.
2. Run `npm run fixes:index`.
3. Commit both files.

Say in `notes` what actually goes wrong without the fix. A fix that lists
settings without explaining the failure is hard for the next person to trust.
