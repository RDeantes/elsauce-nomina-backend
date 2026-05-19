const fetch = global.fetch;
const base = 'http://localhost:3000';

async function run() {
  try {
    console.log('=== TEST START ===');

    const empleado = 1;
    const fecha = '2026-05-19';

    console.log('1) GET /empleados');
    let r = await fetch(`${base}/empleados`);
    console.log('status', r.status);
    let text = await r.text();
    console.log(text.slice(0, 500));

    console.log('\n2) POST /asistencias');
    r = await fetch(`${base}/asistencias`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_empleado: empleado, fecha, hora_entrada: '08:15' })
    });
    console.log('status', r.status);
    console.log(await r.text());

    console.log('\n3) PUT /asistencias/salida');
    r = await fetch(`${base}/asistencias/salida`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_empleado: empleado, fecha, hora_salida: '16:00' })
    });
    console.log('status', r.status);
    console.log(await r.text());

    console.log('\n4) GET /nominas/acumulado/1');
    r = await fetch(`${base}/nominas/acumulado/${empleado}`);
    console.log('status', r.status);
    console.log(await r.text());

    console.log('\n5) POST /nominas/incidencias');
    r = await fetch(`${base}/nominas/incidencias`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_empleado: empleado, fecha, tipo: 'DEDUCCION', concepto: 'COMIDA', monto: 50 })
    });
    console.log('status', r.status);
    console.log(await r.text());

    console.log('\n6) GET /nominas/acumulado/1 después de incidencia');
    r = await fetch(`${base}/nominas/acumulado/${empleado}`);
    console.log('status', r.status);
    console.log(await r.text());

    console.log('\n7) POST /nominas/imprimir-y-pagar/1');
    r = await fetch(`${base}/nominas/imprimir-y-pagar/${empleado}`, { method: 'POST' });
    console.log('status', r.status);
    console.log(await r.text());

    console.log('\n8) GET /nominas/acumulado/1 post pago');
    r = await fetch(`${base}/nominas/acumulado/${empleado}`);
    console.log('status', r.status);
    console.log(await r.text());

    console.log('=== TEST END ===');
  } catch (err) {
    console.error('ERROR', err);
    process.exit(1);
  }
}

run();
