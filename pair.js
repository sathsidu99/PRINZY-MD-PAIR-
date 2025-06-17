const express = require("express");
const fs = require("fs");
const { exec } = require("child_process");
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

const router = express.Router();

function removeFile(filePath) {
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { recursive: true, force: true });
  }
}

router.get("/", async (req, res) => {
  let rawNumber = req.query.number;
  if (!rawNumber) {
    return res.status(400).send({ error: "Missing 'number' parameter" });
  }
  const num = rawNumber.replace(/[^0-9]/g, ""); // sanitize number

  async function startPairing() {
    const { state, saveCreds } = await useMultiFileAuthState(`./session`);

    try {
      const sock = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
        },
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
        browser: Browsers.macOS("Safari"),
      });

      if (!sock.authState.creds.registered) {
        await delay(1500);
        const code = await sock.requestPairingCode(num);

        if (!res.headersSent) {
          res.send({ code });
        }
      }

      sock.ev.on("creds.update", saveCreds);

      sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
        if (connection === "open") {
          try {
            await delay(8000); // wait few sec for file write
            const sessionPath = "./session/creds.json";
            if (!fs.existsSync(sessionPath)) {
              console.error("Session file not found");
              process.exit(1);
            }

            // Upload to mega
            const mega_url = await upload(
              fs.createReadStream(sessionPath),
              `${generateFileName()}.json`
            );

            const string_session = mega_url.replace("https://mega.nz/file/", "");
            const user_jid = jidNormalizedUser(sock.user.id);

            const advancedMessage = `*🌟 PRINZY MD - WhatsApp Bot Session 🌟*\n\n🧩 *Session ID:* \`\`\`${string_session}\`\`\`\n\n⚠️ *DO NOT share this Session ID with anyone!*\n\n📚 *Bot Repository:* [Click Here](https://github.com/sathsidu99/PRINZY-MD)\n\n🤖 *Join My WhatsApp Channel:* https://whatsapp.com/channel/0029VbAtTAg4tRrlSoeQ7e28\n\n💬 *Contact Me:* +94742179316`;

            await sock.sendMessage(user_jid, {
              image: { url: "https://files.catbox.moe/gvyk58.jpeg" },
              caption: advancedMessage,
            });

            await sock.sendMessage(user_jid, { text: `🔑 Your Session ID:\n${string_session}` });
            await sock.sendMessage(user_jid, { text: `🛑 *Never share this code to anyone!* 🛑` });

          } catch (err) {
            console.error("Error after connection open:", err);
            process.exit(1);
          } finally {
            await delay(100);
            removeFile("./session");
            process.exit(0);
          }
        }

        if (connection === "close" && lastDisconnect?.error?.output?.statusCode !== 401) {
          console.warn("Connection closed, restarting...");
          process.exit(1);
        }
      });

    } catch (err) {
      console.error("Fatal Error:", err);
      removeFile("./session");
      process.exit(1);
    }
  }

  await startPairing();
});

// Handle any uncaught exceptions
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  process.exit(1);
});

// Generate random filename for Mega upload
function generateFileName(length = 6, numberLength = 4) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < length; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  const number = Math.floor(Math.random() * Math.pow(10, numberLength));
  return `${text}${number}`;
}

module.exports = router;