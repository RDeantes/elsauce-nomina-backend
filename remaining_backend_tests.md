# Documentación de pruebas: flujo restante de backend

Este documento describe el escenario de prueba ya ejecutado para validar el flujo de asistencias de un mismo día, la acumulación de nómina diaria, la aplicación de incidencias y el pago.

## Requisitos previos

- El servidor debe estar ejecutándose en `http://localhost:3000`
- El empleado de prueba se crea dinámicamente y se usa para los pasos siguientes.
- Fecha de prueba usada en el script: `2026-05-23`

## 1. GET /empleados

Objetivo: verificar que el endpoint de empleados responde con estado `200`.

Request:
- Método: `GET`
- URL: `/empleados`

Resultado esperado:
- `status: 200`
- Lista de empleados en JSON

## 2. POST /empleados

Objetivo: crear un empleado de prueba para el flujo.

Request:
- Método: `POST`
- URL: `/empleados`
- Body JSON:
  ```json
  {
    "nombre": "QA_TEST_2",
    "apellido_paterno": "AUTO",
    "apellido_materno": "PRUEBA",
    "telefono": "0000000001",
    "curp": "QATEST0000000001",
    "direccion": "CALLE TEST 124",
    "fecha_nacimiento": "1991-01-01",
    "fecha_ingreso": "2026-05-18",
    "departamento_id": 1,
    "puesto_id": 4,
    "tipo_contrato": "TEMPORAL",
    "fecha_vigencia": "2026-06-18",
    "nacionalidad": "MEXICANA",
    "sexo": "FEMENINO",
    "Pago_hora": 50,
    "hora_programada_entrada": "08:00:00",
    "Tipo_Pago": "DIARIO",
    "Pago_diario": null
  }
  ```

Resultado esperado:
- `status: 200`
- Objeto JSON con `id_empleado` del nuevo empleado

## 3. POST /asistencias (primera entrada)

Objetivo: registrar la primera entrada del mismo día.

Request:
- Método: `POST`
- URL: `/asistencias`
- Body JSON:
  ```json
  {
    "id_empleado": <id_empleado>,
    "fecha": "2026-05-23",
    "hora_entrada": "08:00"
  }
  ```

Resultado esperado:
- `status: 200`
- Objeto JSON con registro de asistencia y `estatus: "PRESENTE"`

## 4. PUT /asistencias/salida (primera salida)

Objetivo: cerrar el primer periodo de asistencia y generar la nómina diaria pendiente.

Request:
- Método: `PUT`
- URL: `/asistencias/salida`
- Body JSON:
  ```json
  {
    "id_empleado": <id_empleado>,
    "fecha": "2026-05-23",
    "hora_salida": "12:00"
  }
  ```

Resultado esperado:
- `status: 200`
- Mensaje de salida registrada
- Nómina diaria en `PENDIENTE`
- `horas_registradas: "4.00"`

## 5. POST /asistencias (segunda entrada mismo día)

Objetivo: registrar un segundo periodo de trabajo en la misma fecha.

Request:
- Método: `POST`
- URL: `/asistencias`
- Body JSON:
  ```json
  {
    "id_empleado": <id_empleado>,
    "fecha": "2026-05-23",
    "hora_entrada": "13:00"
  }
  ```

Resultado esperado:
- `status: 200`
- Nuevo registro de asistencia independiente creado para la misma fecha

## 6. PUT /asistencias/salida (segunda salida)

Objetivo: cerrar el segundo periodo, comprobar que la nómina diaria acumula ambas horas.

Request:
- Método: `PUT`
- URL: `/asistencias/salida`
- Body JSON:
  ```json
  {
    "id_empleado": <id_empleado>,
    "fecha": "2026-05-23",
    "hora_salida": "17:00"
  }
  ```

Resultado esperado:
- `status: 200`
- Mensaje de nómina generada
- `horas_registradas: "4.00"` para el segundo periodo
- Nómina acumulada del día con `horas_totales: "8"` y `sueldo_bruto: "400"`

## 7. GET /nominas/acumulado/:id_empleado

Objetivo: consultar el acumulado pendiente del empleado.

Request:
- Método: `GET`
- URL: `/nominas/acumulado/<id_empleado>`

Resultado esperado:
- `status: 200`
- `recibos_pendientes: 1`
- `total_acumulado: "400.00"`
- Detalle con `horas_totales: "8"`

## 8. POST /nominas/incidencias (deducción COMIDA)

Objetivo: aplicar una incidencia de deducción a la nómina pendiente del día.

Request:
- Método: `POST`
- URL: `/nominas/incidencias`
- Body JSON:
  ```json
  {
    "id_empleado": <id_empleado>,
    "fecha": "2026-05-23",
    "tipo": "DEDUCCION",
    "concepto": "COMIDA",
    "monto": 100
  }
  ```

Resultado esperado:
- `status: 200`
- Mensaje: `Incidencia (COMIDA) aplicada.`
- Nómina afectada con `comidas: 100`
- `total_neto: "300"`

## 9. GET /nominas/acumulado/:id_empleado después de incidencia

Objetivo: verificar el nuevo acumulado tras la deducción.

Request:
- Método: `GET`
- URL: `/nominas/acumulado/<id_empleado>`

Resultado esperado:
- `status: 200`
- `total_acumulado: "300.00"`
- Nómina pendiente con `total_neto: "300"`

## 10. POST /nominas/imprimir-y-pagar/:id_empleado

Objetivo: liquidar el pago pendiente y generar el recibo.

Request:
- Método: `POST`
- URL: `/nominas/imprimir-y-pagar/<id_empleado>`

Resultado esperado:
- `status: 200`
- Mensaje de pago liquidado
- `total_pagado: "300.00"`
- Generación de archivo `.docx`

## 11. GET /nominas/acumulado/:id_empleado después de pago

Objetivo: confirmar que ya no hay pendientes.

Request:
- Método: `GET`
- URL: `/nominas/acumulado/<id_empleado>`

Resultado esperado:
- `status: 200`
- `recibos_pendientes: 0`
- `total_acumulado: "0.00"`

## 12. PUT /asistencias/justificar con fecha sin falta

Objetivo: validar el manejo de ausencia inexistente.

Request:
- Método: `PUT`
- URL: `/asistencias/justificar`
- Body JSON:
  ```json
  {
    "id_empleado": <id_empleado>,
    "fecha": "2026-05-26",
    "motivo": "Prueba ninguna falta"
  }
  ```

Resultado esperado:
- `status: 404`
- Error: `No se encontró una FALTA para justificar.`

## 13. POST /nominas/incidencias en día sin pendiente

Objetivo: validar el rechazo cuando no hay nómina pendiente.

Request:
- Método: `POST`
- URL: `/nominas/incidencias`
- Body JSON:
  ```json
  {
    "id_empleado": <id_empleado>,
    "fecha": "2026-05-26",
    "tipo": "PERCEPCION",
    "concepto": "BONO",
    "monto": 50
  }
  ```

Resultado esperado:
- `status: 404`
- Error: `No hay nómina pendiente ese día.`

## 14. Pruebas específicas de nómina semanal / quincenal

Objetivo: validar que empleados con `Tipo_Pago` distinto a `DIARIO` reciben el pago fijo `Pago_diario` por día trabajado, incluso si su horario se registra por horas.

Script de prueba:
- Archivo: `weekly_quincenal_tests.js`
- Fecha usada para `SEMANAL`: `2026-05-24`
- Fecha usada para `QUINCENAL`: `2026-05-25`

Flujo por cada tipo de pago:
1. `POST /empleados` con `Tipo_Pago: SEmanal` o `QUINCENAL` y `Pago_diario` definido.
2. `POST /asistencias` entrada a las 08:00.
3. `PUT /asistencias/salida` a las 17:00.
4. `GET /nominas/acumulado/:id_empleado`.
5. `POST /nominas/incidencias` para aplicar una deducción o percepción.
6. `GET /nominas/acumulado/:id_empleado` después de la incidencia.
7. `POST /nominas/imprimir-y-pagar/:id_empleado`.
8. `GET /nominas/acumulado/:id_empleado` después del pago.

Resultado esperado:
- Para `SEMANAL`: `sueldo_bruto` debe ser igual a `Pago_diario` (ej. `550`) y no multiplicarse por las horas.
- Para `QUINCENAL`: `sueldo_bruto` debe ser igual a `Pago_diario` (ej. `560`) y no multiplicarse por las horas.
- El pago debe liquidarse correctamente y dejar `recibos_pendientes: 0`.

## Cómo ejecutar el script

1. Iniciar el servidor con `node server.js`
2. Ejecutar el script de pruebas:
   ```powershell
   node .\remaining_backend_tests.js
   ```

## Resumen de resultados

- El flujo de asistencias permite múltiples entradas/salidas en la misma fecha.
- La nómina diaria se acumula correctamente en un solo registro pendiente.
- Las incidencias de deducción se aplican y ajustan el `total_neto`.
- El pago se liquida correctamente y borra el acumulado pendiente.
- El sistema devuelve `404` en los casos negativos esperados.
