const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { getRoutes } = require("expo-router/build/getRoutesCore");

const appDirectory = path.resolve(__dirname, "../app");

function routeFiles(directory, prefix = ".") {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const key = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) return routeFiles(path.join(directory, entry.name), key);
    return /\.[jt]sx?$/.test(entry.name) ? [key] : [];
  });
}

const context = () => ({ default: () => null });
context.keys = () => routeFiles(appDirectory);

function flatten(node) {
  return [node, ...(node.children ?? []).flatMap(flatten)];
}

for (const platform of ["web", "android", "ios"]) {
  const routes = getRoutes(context, {
    platform,
    importMode: "lazy",
    skipGenerated: true,
    ignoreEntryPoints: true,
  });
  assert.ok(routes, `Nenhuma rota encontrada para ${platform}`);
  const mapRoutes = flatten(routes).filter((route) => route.route === "(app)/map-ride");
  assert.equal(mapRoutes.length, 1, `A rota do mapa deve ser unica em ${platform}`);
  const expected = platform === "web" ? "./(app)/map-ride.web.tsx" : "./(app)/map-ride.tsx";
  assert.equal(mapRoutes[0].contextKey, expected);
  const scanRoutes = flatten(routes).filter((route) => route.route === "scan-demo");
  assert.equal(scanRoutes.length, 1, `A rota do leitor de QR deve ser unica em ${platform}`);
  assert.equal(scanRoutes[0].contextKey, "./scan-demo.tsx");
  console.log(`Rotas ${platform}: OK (${mapRoutes[0].contextKey} + scan-demo)`);
}
