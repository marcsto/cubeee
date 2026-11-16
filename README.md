# cubeee

cubeee is a browser-based F2L trainer with 41 standard cases and 24 advanced cases. It guides a front-right pair setup with white down and green facing you. Cross + F2L records the white cross and each pair as a separate split so you can review, compare, and retry pairs.

Open [cubeee](https://marc.ai/cubeee/) in Chrome or Edge to pair a GAN i4. Turn the white face to wake it and choose **Connect GAN i4**. If the browser asks for the Bluetooth MAC address, use the address shown in CubeStation's device details and disconnect CubeStation before pairing. Connect once while signed in to save the cube's address to your account. On a different computer, sign in with the same account and select the cube in the browser's Bluetooth picker.

In F2L Practice, turn on **Virtual cube** to load each case immediately. Watch the on-screen cube and turn your connected GAN with white down and green facing you. On the completed pair's review screen, turn the top layer for the next case or the left or right face to retry. You can retry or advance to another case from any physical position. Turn off **Virtual cube** to return to guided setup using your GAN's current position.

With the GAN disconnected, use the face buttons or the U, R, F, D, L, and B keys. Hold Shift for a counterclockwise turn or Alt for a half turn. The first detected turn stops the thinking timer and starts the execution timer. Quick consecutive quarter turns in the same direction count as a half turn.

Pick a **Front color** above the suggested solutions to match how you hold the cube. **More orientations** lets you choose the top color. The walkthrough and notation use that grip, and cubeee remembers it with your preferred solution.

The suggested solutions include algorithms from the [CubeSkills F2L guide](https://www.cubeskills.com/uploads/pdf/tutorials/f2l.pdf) by Feliks Zemdegs and Andy Klise. They cover all 41 standard cases and appear in Cross + F2L review when they solve the split and preserve the completed pieces. Opening U turns are aligned to the current setup.

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
