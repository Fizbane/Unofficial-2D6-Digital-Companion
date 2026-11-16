# Unofficial 2D6 Digital

**2D6 Companion** is an unofficial, fan-made play aid for the **2D6 Dungeon**, **2D6 Realm** and **2D6 Void** tabletop games. It gives you a searchable rules reference, clickable roll tables with 3D dice, and play tools that follow the books' flowcharts: dungeon and Dark Hulk turns, combat, character sheets, maps, a journal and more.

> **Disclaimer:** Unofficial 2D6 Digital (2D6 Companion) is an independent production by Fizbane and is not affiliated with DR Games or Toby Lancaster. It is published under the [2D6 Dungeon Third Party License](https://drgames.co.uk/2d6-3rd-party-licence/). It is not official, and it is not endorsed or sponsored by DR Games.
>
> 2D6 Dungeon is copyright of DR Games and Toby Lancaster.
>
> Please do not contact Toby Lancaster or DR Games for support with this tool. Questions about it are not theirs to answer.
>
> This is a passion project that I hope drives interest in the game. If it harms the game or sales in any way, I will revoke it instantly, no questions asked. Toby retains all rights to everything, and if he asks me to change or remove something, it will be done, no questions asked.

## The books are not included

The app ships only free content and the structure needed to find things in a book: no paid book text. To use the paid books (the Tables Codex, Realm and 2D6 Void), open **your own PDF** in Settings → Books. It is read on your device only and never uploaded, and the app keeps just what it needs, so you only do this once per device.

**Don't have the books yet?** Get started today at the [DR Games online shop](https://drgames.co.uk/dr-games-online-shop/).

## Support the books

The 2D6 Companion is free, and the books behind it are how the game gets made. The tables, the flowcharts and the art took years of work, and the physical books are what keep that work going.

If you enjoy using the app, please buy the printed books. A physical copy:

- is the version the designer earns the most from, so it's the best way to say thanks;
- is easier to use at the table, with no screens to juggle and no battery to run out;
- lives on the shelf as a book you keep and can use to bring your friends into the game.

The PDFs are a useful backup and a way to unlock the app's Books features, but they're not a substitute for the printed books. You can get them from the [DR Games online shop](https://drgames.co.uk/dr-games-online-shop/).

## Get the App

### Windows desktop app

Download the newest installer from **[Releases](https://github.com/Fizbane/Unofficial-2D6-Digital/releases/latest)**:

- `2D6-Companion-Setup-<version>.exe` installs it with a Start-menu shortcut, and updates itself (it asks first).
- `2D6-Companion-Portable-<version>.exe` is a single file that runs without installing.

The files aren't code-signed, so Windows SmartScreen may warn the first time: choose **More info → Run anyway**. Everything works offline.

### Run it from the source (any computer with a browser)

You need [Git](https://git-scm.com/) and [Node.js](https://nodejs.org/) 24 or newer.

```
git clone https://github.com/Fizbane/Unofficial-2D6-Digital.git
cd Unofficial-2D6-Digital
npm --prefix app install
npm --prefix app run dev
```

Then open http://localhost:5173. To use it on a tablet or phone on the same Wi-Fi, open the "Network" address it prints (Windows may ask you to allow Node through the firewall). Leave that window running while you play; press Ctrl+C in it to stop.

## Updates

Settings → **Updates** shows your version and has a **Check for updates** button; the app also checks once a day when it opens (you can turn that off). Nothing is downloaded until you say so.

- **Installed desktop app:** downloads the new version, then restarts into it.
- **Portable .exe:** opens the download page; use the new file in place of the old one.
- **Run from the source:** **Update now** runs `git pull` for you (when you haven't changed any files). Then stop the app and start it again.

## Your saves

Characters, maps, notes, the journal and settings are saved on your device only: in the browser you use, or in the desktop app. Settings → **Backup** exports everything to one file, and **Automatic backups** can copy it to a folder (pick one inside OneDrive, Google Drive or iCloud Drive to keep a copy in the cloud). Moving between the browser and the desktop app: export in one, import in the other.

## Guide

The [guide](https://fizbane.github.io/Unofficial-2D6-Digital-Companion/) walks through every section of the app step by step: the interface, the Dungeon and Void tools, the maps, the reference tools, your journal and achievements, and the settings.

## For developers

```
npm --prefix app test          # unit tests
npm --prefix app run build     # production build into app/dist
npx --prefix app install-electron   # once, to run the desktop app from source
npm --prefix app run desktop   # build, then open it in the desktop wrapper
npm --prefix app run dist:win  # Windows installer and portable .exe into app/release
```

The build ends with `check-dist`, which makes sure no book text is in the output. Its full text scan needs a phrase list that is not part of this repo, so here it prints a warning and runs only its structural checks.

## Licence

The code in this repository is released under the [MIT License](LICENSE).

That licence covers this project's own code only. It gives no rights to DR Games' material: the 2D6 Dungeon, 2D6 Realm and 2D6 Void names, logos, rules, text and art belong to DR Games and Toby Lancaster, and are used under the [2D6 Dungeon Third Party License](https://drgames.co.uk/2d6-3rd-party-licence/).
