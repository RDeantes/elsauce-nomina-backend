const fetch = global.fetch;
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const base = 'http://localhost:3000';

async function logFetch(name, url, options) {
  try {
    const res = await fetch(url, options);
    const text = await res.text();
    console.log(`\n=== ${name} ===`);
    console.log('url:', url);
    console.log('status:', res.status);
    console.log(text);
    return { status: res.status, body: text };
  } catch (error) {
    console.error(`\n=== ${name} ERROR ===`, error);
    return { error };
  }
}

(async () => {
  try {
    console.log('### Backend endpoint smoke tests ###');

    // 1. Employee creation
    const newEmpleadoPayload = {
      nombre: 'QA_TEST',
      apellido_paterno: 'AUTO',
      apellido_materno: 'PRUEBA',
      telefono: '0000000000',
      curp: 'QATEST0000000000',
      direccion: 'CALLE TEST 123',
      fecha_nacimiento: '1990-01-01',
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
    const created = await logFetch('POST /empleados', `${base}/empleados`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newEmpleadoPayload)
    });

    let createdEmpleadoId = null;
    if (created.status === 200) {
      const json = JSON.parse(created.body);
      createdEmpleadoId = Number(json.id_empleado);
    }

    // 2. Create a FALTA record directly in DB and justify it
    const faltaFecha = new Date('2026-05-24T00:00:00');
    const faltaEmpleadoId = 1;

    const existingFalta = await prisma.asistencias.findFirst({
      where: { id_empleado: BigInt(faltaEmpleadoId), fecha: faltaFecha, estatus: 'FALTA' }
    });
    if (!existingFalta) {
      await prisma.asistencias.create({
        data: {
          id_empleado: BigInt(faltaEmpleadoId),
          fecha: faltaFecha,
          estatus: 'FALTA',
          minutos_retardo: 0,
          descuento_retardo: 0
        }
      });
      console.log('\nCreated direct FALTA record for justificacion test');
    } else {
      console.log('\nExisting FALTA record found for justificacion test');
    }

    await logFetch('PUT /asistencias/justificar', `${base}/asistencias/justificar`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_empleado: faltaEmpleadoId, fecha: '2026-05-24', motivo: 'Prueba QA' })
    });

    // 3. Weekly employee attendance test
    const weeklyEmpleadoId = 23;
    const weeklyFecha = '2026-05-25';
    await logFetch('POST /asistencias weekly entry', `${base}/asistencias`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_empleado: weeklyEmpleadoId, fecha: weeklyFecha, hora_entrada: '05:20' })
    });
    await logFetch('PUT /asistencias/salida weekly', `${base}/asistencias/salida`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_empleado: weeklyEmpleadoId, fecha: weeklyFecha, hora_salida: '13:20' })
    });
    await logFetch('GET /nominas/acumulado weekly', `${base}/nominas/acumulado/${weeklyEmpleadoId}`);

    // 4. Incidencia on already paid or no pending day
    const payResult = await logFetch('POST /nominas/imprimir-y-pagar weekly', `${base}/nominas/imprimir-y-pagar/${weeklyEmpleadoId}`, { method: 'POST' });
    if (payResult.status === 200) {
      await logFetch('POST /nominas/incidencias after pay', `${base}/nominas/incidencias`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_empleado: weeklyEmpleadoId, fecha: weeklyFecha, tipo: 'DEDUCCION', concepto: 'COMIDA', monto: 50 })
      });
    }

    // 5. Validate any endpoint error handling
    await logFetch('POST /nominas/incidencias missing pending', `${base}/nominas/incidencias`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_empleado: faltaEmpleadoId, fecha: '2026-05-26', tipo: 'DEDUCCION', concepto: 'COMIDA', monto: 50 })
    });

    if (createdEmpleadoId) {
      await logFetch('GET /nominas/acumulado new employee', `${base}/nominas/acumulado/${createdEmpleadoId}`);
    }

    console.log('\n### Tests completed ###');

  } catch (error) {
    console.error('Test script error', error);
  } finally {
    await prisma.$disconnect();
  }
})();