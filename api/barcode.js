export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const { barcode } = req.query;
  if (!barcode) return res.status(400).json({ error: 'No barcode provided' });
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(
      `https://world.openfoodfacts.org/api/v0/product/${barcode}.json`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    if (error.name === 'AbortError') {
      res.status(504).json({ error: 'Request timed out' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
}
