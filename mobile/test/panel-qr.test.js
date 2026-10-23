/** @jest-environment jsdom */
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../../server/static/qrcode.min.js"),
  "utf8"
);
const QRCode = new Function(`${source}; return QRCode;`)();

describe("QR code do painel", () => {
  it("desenha o payload de pareamento sem depender de internet", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const payload = JSON.stringify({
      v: 1,
      server: "http://192.168.15.6:4747",
      session: "browser-abc123",
      peer: "client",
    });

    new QRCode(element, { text: payload, width: 200, height: 200 });

    expect(element.title).toBe(payload);
    expect(element.querySelector("table")).not.toBeNull();
    expect(element.querySelectorAll("td").length).toBeGreaterThan(100);
  });
});
