// Requête POST en JSON avec délai maximal, pour les serveurs locaux (LM Studio, serveur d'images).
async function post(url, body, timeout) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`${url} : HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
  return response.json();
}

module.exports = { post };
