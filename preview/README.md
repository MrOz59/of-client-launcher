# Screen preview

Renders one renderer component on its own, in a browser, so a screen can be
looked at without launching Electron and navigating to it. Nothing here is part
of the app: `build.files` in package.json ships only `dist/`, and `preview/dist`
is already ignored by git.

```bash
npx vite build --config preview/vite.config.ts
python3 -m http.server 8899 --directory preview/dist &
chromium --headless --window-size=1280,900 --virtual-time-budget=4000 \
  --screenshot=/tmp/screen.png http://localhost:8899/index.html
```

`main.tsx` mocks the `window.electronAPI` calls the component makes and holds
the sample data. `#<tab>` opens that tab, `?broken=1` feeds it invalid values to
see the validation state. Point it at another component by changing the import.
