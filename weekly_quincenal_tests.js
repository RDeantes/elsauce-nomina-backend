const fetch = global.fetch;
const base = 'http://localhost:3000';

async function request(name, url, options) {
  try {
    const res = await fetch(url, options);
    const text = await res.text();
    console.log(`\n=== ${name} ===`);
    console.log('status:', res.status);
    console.log(text);
    return { status: res.status, body: text };
  } catch (error) {
    console.error(`\n=== ${name} ERROR ===`);
    console.error(error);
    return { error };
  }
}

function buildEmpleadoPayload(tipoPago, pagoDiario) {
  return {
    nombre: `QA_${tipoPago}_TEST`,
    apellido_paterno: 'AUTO',
    apellido_materno: 'PRUEBA',
    telefono: '0000000001',
    curp: `QATEST${tipoPago}0000001`,
    direccion: `CALLE TEST ${tipoPago}`,
    fecha_nacimiento: '1991-01-01',
    fecha_ingreso: '2026-05-18',
    departamento_id: 1,
    puesto_id: 4,
    tipo_contrato: 'TEMPORAL',
    fecha_vigencia: '2026-06-18',
    nacionalidad: 'MEXICANA',
    sexo: 'FEMENINO',
    Pago_hora: null,
    hora_programada_entrada: '08:00:00',
    Tipo_Pago: tipoPago,
    Pago_diario: pagoDiario
  };
}

async function runTest(tipoPago, pagoDiario, fecha, entrada, salida, incidencia) {
  console.log(`\n*** Test para ${tipoPago} ***`);

  const payload = buildEmpleadoPayload(tipoPago, pagoDiario);
  const createResp = await request(`POST /empleados (${tipoPago})`, `${base}/empleados`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (createResp.status !== 200) return;

  let idEmpleado;
  try {
    idEmpleado = Number(JSON.parse(createResp.body).id_empleado);
  } catch (error) {
    console.error('No se pudo parsear id_empleado');
    return;
  }

  await request(`POST /asistencias entrada ${entrada} (${tipoPago})`, `${base}/asistencias`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_empleado: idEmpleado, fecha, hora_entrada: entrada })
  });

  await request(`PUT /asistencias/salida ${salida} (${tipoPago})`, `${base}/asistencias/salida`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_empleado: idEmpleado, fecha, hora_salida: salida })
  });

  await request(`GET /nominas/acumulado/${idEmpleado} (${tipoPago})`, `${base}/nominas/acumulado/${idEmpleado}`);

  if (incidencia) {
    await request(`POST /nominas/incidencias (${tipoPago})`, `${base}/nominas/incidencias`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_empleado: idEmpleado, fecha, tipo: incidencia.tipo, concepto: incidencia.concepto, monto: incidencia.monto })
    });
    await request(`GET /nominas/acumulado/${idEmpleado} after incidencia (${tipoPago})`, `${base}/nominas/acumulado/${idEmpleado}`);
  }

  await request(`POST /nominas/imprimir-y-pagar/${idEmpleado} (${tipoPago})`, `${base}/nominas/imprimir-y-pagar/${idEmpleado}`, {
    method: 'POST'
  });

  await request(`GET /nominas/acumulado/${idEmpleado} after pago (${tipoPago})`, `${base}/nominas/acumulado/${idEmpleado}`);
}

(async () => {
  console.log('### Running weekly/quincenal payroll tests ###');

  const fechaSemanal = '2026-05-24';
  const fechaQuincenal = '2026-05-25';

  await runTest('SEMANAL', 550, fechaSemanal, '08:00', '17:00', { tipo: 'DEDUCCION', concepto: 'COMIDA', monto: 50 });
  await runTest('QUINCENAL', 560, fechaQuincenal, '08:00', '17:00', { tipo: 'PERCEPCION', concepto: 'BONO', monto: 100 });

  console.log('\n### Weekly/Quincenal tests completed ###');
})();
