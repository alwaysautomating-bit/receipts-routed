import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Google Sheets Setup
const getSheetsClient = () => {
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!clientEmail || !privateKey) {
    console.warn("Google Sheets configuration missing. Records will be logged but not saved to Sheets.");
    return null;
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: clientEmail,
      private_key: privateKey,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return google.sheets({ version: 'v4', auth });
};

const sheetsClient = getSheetsClient();
const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // API routes
  app.post("/api/captures", async (req, res) => {
    const { rawInput, userNotes, fileName } = req.body;
    console.log("Saving raw capture:", { fileName, rawInputLength: rawInput?.length });
    // In a real app, save to a 'Captures' table or blob storage
    const id = "cap_" + Math.random().toString(36).substring(7);
    res.json({ id, success: true });
  });

  app.post("/api/records", async (req, res) => {
    const record = req.body;
    
    // Capture Title Logic
    const vendor = record.vendor || "Unprocessed Invoice";
    const date = record.invoiceDate || new Date().toISOString().split('T')[0];
    const captureTitle = record.vendor && record.invoiceDate 
      ? `${record.vendor} - ${record.invoiceDate}`
      : `Unprocessed Invoice - ${new Date().getTime()}`;

    const sheetsData = [
      captureTitle,
      record.vendor,
      parseFloat(record.amount) || 0,
      record.invoiceDate,
      record.captureType,
      "Processed",
      record.routeTo === "Airtable Only" ? "Google Sheets Only" : record.routeTo,
      record.userNotes,
      record.exceptionType || "",
      record.processingNotes,
      record.source || "Manual Input",
      record.rawInput
    ];

    console.log("Routing to Google Sheets:", sheetsData);

    try {
      if (sheetsClient && spreadsheetId) {
        await sheetsClient.spreadsheets.values.append({
          spreadsheetId,
          range: 'Sheet1!A:L',
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [sheetsData]
          }
        });
        res.json({ success: true, message: "Record created in Google Sheets" });
      } else {
        // Mock success if Google Sheets not configured
        await new Promise(resolve => setTimeout(resolve, 800));
        res.json({ 
          success: true, 
          message: "Google Sheets not configured, record logged to console.",
          mock: true 
        });
      }
    } catch (error) {
      console.error("Google Sheets Error:", error);
      res.status(500).json({ success: false, error: "Failed to create record in Google Sheets" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
