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

(async () => {
  console.log('### Running remaining backend tests ###');

  await request('GET /empleados', `${base}/empleados`);

  const newEmpleadoPayload = {
    nombre: 'QA_TEST_2',
    apellido_paterno: 'AUTO',
    apellido_materno: 'PRUEBA',
    telefono: '0000000001',
    curp: 'QATEST0000000001',
    direccion: 'CALLE TEST 124',
    fecha_nacimiento: '1991-01-01',
    fecha_ingreso: '2026-05-18',
    departamento_id: 1,
    puesto_id: 4,
    tipo_contrato: 'TEMPORAL',
    fecha_vigencia: '2026-06-18',
    nacionalidad: 'MEXICANA',
    sexo: 'FEMENINO',
    Pago_hora: 50,
    hora_programada_entrada: '08:00:00',
    Tipo_Pago: 'DIARIO',
    Pago_diario: null
  };
  const createEmpleado = await request('POST /empleados', `${base}/empleados`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(newEmpleadoPayload)
  });

  let newEmpleadoId = null;
  if (createEmpleado.status === 200) {
    try {
      const data = JSON.parse(createEmpleado.body);
      newEmpleadoId = Number(data.id_empleado);
      console.log('Created employee id:', newEmpleadoId);
    } catch (e) {
      console.log('Failed to parse create employee response.');
    }
  }

  const fecha = '2026-05-23';
  const idEmpleado = newEmpleadoId || 46;

  await request('POST /asistencias entrada 08:00', `${base}/asistencias`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_empleado: idEmpleado, fecha, hora_entrada: '08:00' })
  });

  await request('PUT /asistencias/salida 12:00', `${base}/asistencias/salida`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_empleado: idEmpleado, fecha, hora_salida: '12:00' })
  });

  await request('POST /asistencias entrada 13:00', `${base}/asistencias`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_empleado: idEmpleado, fecha, hora_entrada: '13:00' })
  });

  await request('PUT /asistencias/salida 17:00', `${base}/asistencias/salida`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_empleado: idEmpleado, fecha, hora_salida: '17:00' })
  });

  await request('GET /nominas/acumulado same day', `${base}/nominas/acumulado/${idEmpleado}`);

  await request('POST /nominas/incidencias COMIDA 100', `${base}/nominas/incidencias`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_empleado: idEmpleado, fecha, tipo: 'DEDUCCION', concepto: 'COMIDA', monto: 100 })
  });

  await request('GET /nominas/acumulado after incidencia', `${base}/nominas/acumulado/${idEmpleado}`);

  await request('POST /nominas/imprimir-y-pagar same day', `${base}/nominas/imprimir-y-pagar/${idEmpleado}`, {
    method: 'POST'
  });

  await request('GET /nominas/acumulado after pago', `${base}/nominas/acumulado/${idEmpleado}`);

  await request('PUT /asistencias/justificar no falta', `${base}/asistencias/justificar`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_empleado: idEmpleado, fecha: '2026-05-26', motivo: 'Prueba ninguna falta' })
  });

  await request('POST /nominas/incidencias invalid day', `${base}/nominas/incidencias`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_empleado: idEmpleado, fecha: '2026-05-26', tipo: 'PERCEPCION', concepto: 'BONO', monto: 50 })
  });

  console.log('\n### Remaining tests completed ###');
})();
