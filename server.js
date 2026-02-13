import express from "express";
import axios from "axios";
import bodyParser from "body-parser";
import { google } from "googleapis";

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const routes = ["701","702","703","704","705","706"];

const sessions = {};



app.use(express.json());



app.use((req, res, next) => {
  console.log("INCOMING REQUEST:", req.method, req.url);
  next();
});



app.get("/privacy-policy", (req, res) => {
  res.send(`
    <h1>Privacy Policy</h1>
    <p>Effective Date: ${new Date().toISOString().split("T")[0]}</p>

    <p>This application provides booking services via WhatsApp and integrates with Google Calendar.</p>

    <h2>Information We Collect</h2>
    <ul>
      <li>WhatsApp phone number</li>
      <li>Messages sent to the booking system</li>
      <li>Booking date and route selection</li>
    </ul>

    <h2>How We Use Information</h2>
    <p>Information is used solely to create and manage calendar bookings.</p>

    <h2>Data Storage</h2>
    <p>No personal data is sold or shared with third parties. Booking data is stored only within Google Calendar.</p>

    <h2>Contact</h2>
    <p>For questions, contact: your@email.com</p>
  `);
});

app.get("/terms-of-service", (req, res) => {
  res.send(`
    <h1>Terms of Service</h1>
    <p>Effective Date: ${new Date().toISOString().split("T")[0]}</p>

    <p>By using this booking service, you agree to the following terms:</p>

    <ul>
      <li>The system is provided "as is" without guarantees.</li>
      <li>Bookings are subject to availability.</li>
      <li>Misuse of the system may result in access restriction.</li>
    </ul>

    <h2>Limitation of Liability</h2>
    <p>The service provider is not liable for missed bookings or scheduling conflicts.</p>

    <h2>Changes</h2>
    <p>We reserve the right to modify these terms at any time.</p>
  `);
});

// Google Auth
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ["https://www.googleapis.com/auth/calendar"],
});
const calendar = google.calendar({ version: "v3", auth });

// Webhook verification
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
      console.log("Webhook verified!");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});

// Receive messages
app.post("/webhook", async (req, res) => {
  const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message) return res.sendStatus(200);

  const from = message.from;
  const text = message.text?.body?.trim();

  if (!sessions[from]) sessions[from] = { step: "start" };

  try {

    if (text.toUpperCase() === "BOOK") {
      const nextDates = getNextAvailableDates();
      sessions[from] = { step: "awaiting_date", dates: nextDates };

      let msg = "Available Dates:\n";
      nextDates.forEach((d, i) => {
        msg += `${i+1}️⃣ ${d}\n`;
      });
      msg += "\nReply with date number.";

      await sendMessage(from, msg);
    }

    else if (sessions[from].step === "awaiting_date") {
      const index = parseInt(text) - 1;
      const selectedDate = sessions[from].dates[index];

      if (!selectedDate) {
        await sendMessage(from, "Invalid selection.");
        return res.sendStatus(200);
      }

      sessions[from] = {
        step: "awaiting_route",
        selectedDate
      };

      await sendMessage(from,
        `Selected ${selectedDate}\n\nAvailable Routes:\n${routes.join("\n")}\n\nReply with route number.`
      );
    }

    else if (sessions[from].step === "awaiting_route") {
      if (!routes.includes(text)) {
        await sendMessage(from, "Invalid route number.");
        return res.sendStatus(200);
      }

      const selectedDate = sessions[from].selectedDate;

      const start = new Date(`${selectedDate}T01:00:00`);
      const end = new Date(`${selectedDate}T08:00:00`);

      const events = await calendar.events.list({
        calendarId: "primary",
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
      });

      if (events.data.items.length > 0) {
        await sendMessage(from, "❌ Date already booked.");
      } else {
        await calendar.events.insert({
          calendarId: "primary",
          requestBody: {
            summary: `Route ${text} – Cover Driver`,
            start: { dateTime: start.toISOString() },
            end: { dateTime: end.toISOString() },
          },
        });

        await sendMessage(from,
          `✅ Booking Confirmed\nDate: ${selectedDate}\nRoute: ${text}`
        );

        await sendMessage("YOUR_NUMBER_HERE",
          `📢 New Booking\nDate: ${selectedDate}\nRoute: ${text}`
        );
      }

      delete sessions[from];
    }

  } catch (err) {
    console.error(err);
  }

  res.sendStatus(200);
});

function getNextAvailableDates() {
  const today = new Date();
  const allowedDays = [1,2,4,6]; // Example: Mon Tue Thu Sat
  const results = [];

  for (let i = 0; results.length < 4; i++) {
    const d = new Date();
    d.setDate(today.getDate() + i);
    if (allowedDays.includes(d.getDay())) {
      results.push(d.toISOString().split("T")[0]);
    }
  }

  return results;
}

async function sendMessage(to, message) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      text: { body: message }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

app.listen(process.env.PORT || 3000, () =>
  console.log("Server running"));





