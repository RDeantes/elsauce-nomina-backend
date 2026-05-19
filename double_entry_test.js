const fetch = global.fetch;
const base = 'http://localhost:3000';

(async () => {
  const empleado = 1;
  const fecha = '2026-05-21';
  try {
    console.log('1) Entrada 08:00');
    let r = await fetch(`${base}/asistencias`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_empleado: empleado, fecha, hora_entrada: '08:00' })
    });
    console.log('status', r.status, await r.text());

    console.log('2) Salida 12:00');
    r = await fetch(`${base}/asistencias/salida`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_empleado: empleado, fecha, hora_salida: '12:00' })
    });
    console.log('status', r.status, await r.text());

    console.log('3) Entrada 13:00');
    r = await fetch(`${base}/asistencias`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_empleado: empleado, fecha, hora_entrada: '13:00' })
    });
    console.log('status', r.status, await r.text());

    console.log('4) Salida 17:00');
    r = await fetch(`${base}/asistencias/salida`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_empleado: empleado, fecha, hora_salida: '17:00' })
    });
    console.log('status', r.status, await r.text());

    console.log('5) Acumulado');
    r = await fetch(`${base}/nominas/acumulado/${empleado}`);
    console.log('status', r.status, await r.text());
  } catch (err) {
    console.error('ERR', err);
  }
})();
