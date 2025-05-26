// Filename: google_data.js


// Sheet config
const SHEET_ID = "17tcIv9dwmQ-pT2B5Dq4Wk6iQcHM-az6bsuoLLj3sSvk";
const API_KEY = "AIzaSyBh7W54jknREsNQzmKIMjnPBCuow1RzNAs";
const SHEET_NAME = "ALATI!A1:E100"; // ili ostavi prazno ako ne znaš

// Generiši URL
const url1 = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}?alt=media&key=${API_KEY}`;
const url =`"https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(SHEET_NAME)}?key=${API_KEY}`;

// Fetch CSV (Google Sheets CSV export preko API)
export async function loadSheetAsJSON() {
  const response = await fetch(url);
 if (!response.ok) return response;
 const json = await response.json();
 return json.values; // matrica nizova
}
