const express = require("express");
const fs = require("fs");
const { exec } = require("child_process");
let router = express.Router();
const pino = require("pino");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers,
  jidNormalizedUser,
} = require("@whiskeysockets/baileys");
const { upload } = require("./mega");

// Clean old files
function removeFile(FilePath) {
  if (!fs.existsSync(FilePath)) return false;
  fs.rmSync(FilePath, { recursive: true, force: true });
}

// Route: GET /?number=NUMBER
router.get("/", async (req, res) => {
  let num = req.query.number;

  // Main function
  async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(`./session`);

    let sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(
          state.keys,
          pino({ level: "silent" })
        ),
      },
      logger: pino({ level: "silent" }),
      browser: Browsers.macOS("Safari"),
      printQRInTerminal: false,
    });

    sock.ev.on("creds.update", saveCreds); // Always save updates

    // ✅ If already registered, skip pairing
    if (sock.authState.creds.registered) {
      if (!res.headersSent) {
        res.send({ status: "Already paired!" });
      }
      return;
    }

    try {
      // Clean number format
      num = num.replace(/[^0-9]/g, "");
      const code = await sock.requestPairingCode(num);

      if (!res.headersSent) {
        res.send({ code });
      }

      sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === "open") {
          console.log("✅ Connected!");

          await delay(5000); // Delay before sending session info
          const user_jid = jidNormalizedUser(sock.user.id);

          // Upload session to mega
          const mega_url = await upload(
            fs.createReadStream("./session/creds.json"),
            `${generateRandomId()}.json`
          );

          const session_id = mega_url.replace("https://mega.nz/file/", "");

          const sessionText = `*𝐏𝐑𝐈𝐍𝐙𝐘 𝐌𝐃 [The powerful WA BOT]*\n\n👉 ${session_id} 👈\n\n*Copy this Session ID and paste into config.js*\n\n🔗 Bot Repo: https://github.com/sathsidu99/PRINZY-MD\n\n⚠ *Do not share this code!*`;

          await sock.sendMessage(user_jid, {
            image: { url: "https://files.catbox.moe/gvyk58.jpeg" },
            caption: sessionText,
          });

          await sock.sendMessage(user_jid, {
            text: session_id,
          });

          await sock.sendMessage(user_jid, {
            text: "🛑 *Do not share this code to anyone* 🛑",
          });

          await delay(500);
          console.log("✅ Session sent successfully!");

        } else if (connection === "close") {
          const code = lastDisconnect?.error?.output?.statusCode;
          console.log("Disconnected with code: ", code);
          if (code !== 401) {
            exec("pm2 restart Robin");
          }
        }
      });

    } catch (err) {
      console.log("Error during pairing:", err);
      if (!res.headersSent) {
        res.send({ code: "Service Unavailable" });
      }
      exec("pm2 restart Robin");
    }
  }

  // Start pairing or resume existing session
  await startBot();
});

// Utility function to generate random file name for mega upload
function generateRandomId(length = 8) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

process.on("uncaughtException", function (err) {
  console.log("Caught exception: " + err);
  exec("pm2 restart Robin");
});

module.exports = router;
