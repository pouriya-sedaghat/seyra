// Fault injector for lifecycle tests (review R2): grab HOST:PORT as soon as it is free (i.e. right
// after an activation stops the old proxy) so the following `docker compose up` genuinely fails to
// publish the new proxy. No mocks: Docker's own port binding fails.
//
//   node port-squatter.mjs HOST PORT READY_FILE [RELEASE_WHEN_FILE_CONTAINS FILE TEXT]
//
// Writes READY_FILE once it holds the port. With a release condition it closes the port when FILE
// contains TEXT (e.g. history.jsonl gains "activation_failed"), so recovery can succeed; without
// one it holds the port until killed (recovery must fail and `seyra-maps recover` finish later).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';

const [host, port, readyFile, watchFile, text] = process.argv.slice(2);
const baseline = watchFile && existsSync(watchFile) ? readFileSync(watchFile, 'utf8').split(text).length : 0;

function grab() {
  const srv = createServer((s) => s.destroy());
  srv.once('error', () => setTimeout(grab, 50));
  srv.listen(Number(port), host, () => {
    writeFileSync(readyFile, `${process.pid}\n`);
    if (!watchFile) return;
    const t = setInterval(() => {
      const n = existsSync(watchFile) ? readFileSync(watchFile, 'utf8').split(text).length : 0;
      if (n > baseline) {
        clearInterval(t);
        srv.close(() => process.exit(0));
      }
    }, 50);
  });
}
grab();
