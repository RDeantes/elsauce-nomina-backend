const fetch = global.fetch;
const base = "http://localhost:3000";
async function run() {
  try {
    const empleado = 1;
    const fecha = "2026-05-20";
    console.log("=== CLEAN FLOW TEST START ===");
    let r = await fetch(`${base}/asistencias`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id_empleado: empleado, fecha, hora_entrada: "08:15" }) });
    console.log("POST /asistencias", r.status, await r.text());
    r = await fetch(`${base}/asistencias/salida`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id_empleado: empleado, fecha, hora_salida: "16:00" }) });
    console.log("PUT /asistencias/salida", r.status, await r.text());
    r = await fetch(`${base}/nominas/acumulado/${empleado}`);
    console.log("GET /nominas/acumulado", r.status, await r.text());
    r = await fetch(`${base}/nominas/incidencias`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id_empleado: empleado, fecha, tipo: "DEDUCCION", concepto: "COMIDA", monto: 50 }) });
    console.log("POST /nominas/incidencias", r.status, await r.text());
    r = await fetch(`${base}/nominas/acumulado/${empleado}`);
    console.log("GET /nominas/acumulado after incidence", r.status, await r.text());
    r = await fetch(`${base}/nominas/imprimir-y-pagar/${empleado}`, { method: "POST" });
    console.log("POST /nominas/imprimir-y-pagar", r.status, await r.text());
    r = await fetch(`${base}/nominas/acumulado/${empleado}`);
    console.log("GET /nominas/acumulado final", r.status, await r.text());
    console.log("=== CLEAN FLOW TEST END ===");
  } catch (err) {
    console.error("ERROR", err);
    process.exit(1);
  }
}
run();
