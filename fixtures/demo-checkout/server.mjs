import { createServer } from 'node:http';
const port = Number(process.env.CAI_DEMO_PORT ?? '4317');
const broken = process.env.CAI_DEMO_BROKEN === 'true';
const server = createServer((_request, response) => {
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Synthetic checkout</title></head><body><h1>Synthetic checkout</h1><form><label>Card expiry <input name="expiry" autocomplete="off"></label><button type="submit">Pay</button></form><p data-testid="card-error" role="status"></p><script>document.querySelector('form').onsubmit=event=>{event.preventDefault();const expiry=document.querySelector('input').value;document.querySelector('[data-testid="card-error"]').textContent=expiry==='01/20'&&${String(!broken)}?'Card expired':'Payment accepted';};</script></body></html>`,
  );
});
server.listen(port, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    server.close();
  });
