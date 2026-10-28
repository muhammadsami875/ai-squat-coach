# AI Squat Coach

Webcam se squat track karta hai (MediaPipe Pose), reps count karta hai aur form par live feedback deta hai:

- **Clean reps** counter (target set kar sakte hain)
- **Form score** (0-100) har rep ka, aur average
- **Depth gauge** (knee angle live)
- **Knee angle graph** (pichhle 15 seconds)
- **Rep breakdown**: har rep ka score aur masla (DEPTH / BACK / HEELS)
- Voice feedback (browser ki awaaz mein)

Sab kuch browser mein chalta hai. Video kahin upload nahi hoti, aur koi API key nahi chahiye.

## VS Code mein chalane ke steps

1. Is folder ko VS Code mein kholein: **File > Open Folder > `ai-squat-coach`**.
2. Chalane ka **ek** tareeqa chunein:

   **Tareeqa A: Live Server (sabse aasan)**
   1. VS Code mein Extensions (Ctrl+Shift+X) kholein, **Live Server** (Ritwick Dey) install karein.
   2. `index.html` par right-click karein, phir **Open with Live Server**.

   **Tareeqa B: Python (agar Python installed hai)**
   1. VS Code mein Terminal kholein (Ctrl + `).
   2. Chalayein: `python -m http.server 8000`
   3. Browser mein kholein: http://localhost:8000

3. Chrome ya Edge mein page khulne par **Start camera** dabayein aur camera ki permission **Allow** karein.
4. Camera ko side se rakhein, poora body (sar se pair tak) nazar aaye. Seedhe khade hon, phir squat shuru karein.

> `index.html` ko double-click karke na kholein. Browser ES modules aur camera `file://` par block kar deta hai.
> Internet zaroori hai (MediaPipe model CDN se load hota hai).

Camera na ho to **Test with video file** se kisi squat ki video par bhi test kar sakte hain (side view wali).

## Thresholds badalna

`squat-logic.js` ke `CONFIG` mein:

| Setting | Matlab |
|---|---|
| `depthTarget` | Kitna neeche jana zaroori hai (knee angle, chhota = zyada gehra) |
| `leanLimit` | Seena kitna aage jhuk sakta hai (degrees) |
| `heelRiseLimit` | Edi kitni uthne par HEELS flag lage |

## Logic test (optional, Node.js chahiye)

```
node test-logic.mjs
```

## GitHub par upload karna

1. https://github.com par login karein, **New repository** banayein, naam `ai-squat-coach` (khali repo, README add na karein).
2. VS Code terminal mein (is folder ke andar):

```
git init
git add .
git commit -m "AI squat coach"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/ai-squat-coach.git
git push -u origin main
```

3. (Optional) Website ki tarah live karna: GitHub repo > **Settings > Pages > Branch: main / root > Save**.
   Kuch minute baad link milega, aur HTTPS ki wajah se camera wahan bhi chalega.

## Files

| File | Kaam |
|---|---|
| `index.html` | Page ka structure |
| `style.css` | Dark dashboard design |
| `app.js` | Camera, pose tracking, drawing, dashboard |
| `squat-logic.js` | Angle maths aur rep counting / scoring |
| `test-logic.mjs` | Rep logic ka test |
