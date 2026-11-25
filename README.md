# cubeee

cubeee is a browser-based F2L trainer with 41 standard cases and 24 advanced cases. Practice with white down and green facing you. Cross + F2L records the white cross and each pair as a separate split so you can review, compare, and retry pairs.

Open [cubeee](https://marc.ai/cubeee/) in Chrome or Edge to pair a GAN i4. Turn the white face to wake it and choose **Connect GAN i4**. If the browser asks for the Bluetooth MAC address, use the address shown in CubeStation's device details and disconnect CubeStation before pairing. Connect once while signed in to save the cube's address to your account. On a different computer, sign in with the same account and select the cube in the browser's Bluetooth picker.

In F2L Practice, turn on **Virtual cube** to load each case immediately. Watch the on-screen cube and turn your connected GAN with white down and green facing you. On the completed pair's review screen, turn the left or right face for the next case or the top layer to retry. You can retry or advance to another case from any physical position. Turn off **Virtual cube** to return to guided setup using your GAN's current position.

Random practice varies the target slot across all four sides and varies the top-layer alignment when the target corner or edge is on top. Use the listed colors to find the pair, or choose **Show slot** for a hint. **Next case** deals a new position. **Try again** repeats the same start. Picking a case from the library opens its standard front-right setup.

In a **Cross + F2L** solve breakdown, select a pair and choose **Practice this pair**. Virtual cube is on by default and loads the exact position from that split, including the earlier pairs. Solve it using your connected GAN or the on-screen controls. On the result screen, turn the top layer to retry the same pair; left and right turns are ignored. **Restart pair** resets an unfinished attempt, and **Back to breakdown** lets you pick another pair. Turn off **Virtual cube** for guided setup on your physical cube.

In both F2L Practice and Cross + F2L pair practice, drag the virtual cube with a finger or mouse to inspect another angle. When your GAN i4 sends gyroscope readings, **Rotation tracking** lets the view follow the physical cube. To set the level view, hold the cube flat with white down and green facing you, then choose **Align view**. The left, right, and top shortcuts use the faces from that grip. GAN i4's Burst mode keeps the gyroscope on.

With the GAN disconnected, use the face buttons or the U, R, F, D, L, and B keys. Hold Shift for a counterclockwise turn or Alt for a half turn. The first detected turn stops the thinking timer and starts the execution timer. Quick consecutive quarter turns in the same direction count as a half turn.

Solutions open by default during pair practice. As you turn the cube, each solution underlines its matching moves in green. Choose **Hide solutions** to practice from memory. Open **Grip** below the solutions to choose the front and top colors. The walkthrough and notation use that grip, and cubeee remembers it with your preferred solution.

The suggested solutions include algorithms from the [CubeSkills F2L guide](https://www.cubeskills.com/uploads/pdf/tutorials/f2l.pdf) by Feliks Zemdegs and Andy Klise. They cover all 41 standard cases and appear in Cross + F2L review when they solve the split and preserve the completed pieces. Opening U turns are aligned to the current setup.

After pairing, turn the white face to wake your cube. Click **Reconnect Cube** or press **Space** to connect directly while the tab stays open. Browsers with `getDevices()` can restore that shortcut after a reload. If the browser also supports `watchAdvertisements()`, cubeee reconnects automatically when the cube advertises while the tab is visible. Other browsers need the picker again after a reload. Use **Choose cube…** to select a different cube or renew permission.

When you reload a connected tab, cubeee tries to resume that cube as soon as the browser returns its saved permission. If Chrome on Android asks you to select the cube after each reload, enable **Use the new permissions backend for Web Bluetooth** at `chrome://flags/#enable-web-bluetooth-new-permissions-backend`, relaunch Chrome, and select the cube once more.

The Bluetooth button shows the cube’s reported battery percentage on every page. After disconnecting, it shows the last reading saved in this browser. Manual disconnect and the 15-minute idle timeout pause automatic reconnect for the rest of the page session. Click **Reconnect Cube** or press **Space** to resume.

**Sync state** reads the sticker positions stored in the GAN. If your physical cube is fully solved and the live view still shows a scramble after syncing, open **GAN i4 connected → Calibrate solved cube…**. Check all six faces, choose **My cube is solved**, and keep the cube still while cubeee verifies the new position.

## History

Sign in with Google to sync completed F2L practice, Cross + F2L solves, pair retries, preferred algorithms, and the practice filter across computers. In **History → Case practice**, pick a day to see which cases you completed and how many reps you did. Choose **Practice these cases** to review that day's set. Open **All attempts** to reopen a saved Cross + F2L solve or export a date range as JSON. Guest attempts and preferences stay in the browser. History shows the latest 250 attempts, and account exports can include older attempts.

## Development

```sh
npm ci
npm run dev
npm run build
npm run build:pages
```

`node scripts/generate-cases.js` rebuilds the case catalog. Its solutions use face turns and preserve the white cross and any already solved slots in the case.

The GitHub Pages workflow builds with the `/cubeee/` base path. Firebase uses the Spark plan with Google Authentication and a Firestore Standard database. `src/firebase-config.json` holds the public web SDK configuration. Firestore rules scope each document to the owning Google account's Firebase UID. To deploy rules from a Firebase CLI session with access to the project, run `firebase deploy --only firestore:rules --project cubeee-marcsto`.
