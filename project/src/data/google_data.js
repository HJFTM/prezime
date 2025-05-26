// Sheet config
const SHEET_ID = "17tcIv9dwmQ-pT2B5Dq4Wk6iQcHM-az6bsuoLLj3sSvk";
const API_KEY = "AIzaSyBh7W54jknREsNQzmKIMjnPBCuow1RzNA";

const SHEET_NAME = "ALATI!A1:E100"; 

// Generiši URL
const url =`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(SHEET_NAME)}?key=${API_KEY}`;

export async function loadSheetAsJSON() {
  console.log("API_KEY:", API_KEY); // Trebalo bi da ispiše ključ, a ne undefined

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
  }
  const json = await response.json();
  return json.values; // vraća niz nizova, gde je prvi niz zaglavlje
}
