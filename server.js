const QRCode = require("qrcode");
const express = require("express");
const cors = require("cors");
const { PrismaClient } = require("@prisma/client");
const cron = require("node-cron");
// Librerías para generar el recibo en Word
const { Document, Packer, Paragraph, TextRun, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle } = require("docx");
const fs = require("fs");

const prisma = new PrismaClient();
const app = express();

app.use(cors());
app.use(express.json());
app.get("/", (req, res) => {
    res.json({
        mensaje: "Backend funcionando 🚀"
    });
});

// ============================================================
// 1. FUNCIONES DE AYUDA (HELPERS)
// ============================================================

/**
 * Convierte objetos que contienen BigInt a String para evitar errores de JSON.
 * También formatea las fechas para extraer solo YYYY-MM-DD.
 */
function convertirBigInt(data) {
    return JSON.parse(
        JSON.stringify(
            data,
            (key, value) => {
                if (typeof value === "bigint") return value.toString();
                if (key === "fecha" && value) return value.split('T')[0];
                return value;
            }
        )
    );
}

/**
 * Convierte un string de hora ("08:30") a minutos totales (510).
 * Facilita las restas matemáticas para sacar horas trabajadas y retardos.
 */
function convertirHoraAMinutos(hora) {
    if (!hora) return 0;
    const [h, m] = hora.split(":");
    return (parseInt(h) * 60) + parseInt(m);
}



app.get("/empleados/:id/qr", async (req, res) => {
  try {
    const { id } = req.params;

    // Contenido del QR
    const contenido = `id_empleado=${id}`;

    // Generar QR en base64
    const qr = await QRCode.toDataURL(contenido);

    res.json({
      ok: true,
      qr,
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      ok: false,
      mensaje: "Error generando QR",
    });
  }
});
// ============================================================
// 2. TAREAS AUTOMÁTICAS (CRON JOBS)
// ============================================================

/**
 * CRON: Pre-carga diaria (01:00 AM   (01***))
 * (*****)PARA CARGAR CADA MINUTO
 * Le asigna FALTA a los que deben trabajar y DESCANSO a los que tienen su día libre.
 */
cron.schedule('0 1 * * *', async () => {
    console.log("⏳ Ejecutando pre-carga de asistencias (FALTAS y DESCANSOS)...");
    try {
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0); 
        
        let diaSemanaActual = hoy.getDay(); 
        if (diaSemanaActual === 0) diaSemanaActual = 7; // Ajuste para que Domingo sea 7 en BD

        const empleados = await prisma.empleados.findMany({
            where: { activo: true },
            include: { descansos_empleados: true }
        });

        const asistenciasPorCrear = empleados.map(emp => {
            const descansaHoy = emp.descansos_empleados.some(d => d.dia_semana === diaSemanaActual);
            return {
                id_empleado: emp.id_empleado,
                fecha: hoy,
                estatus: descansaHoy ? "DESCANSO" : "FALTA",
                minutos_retardo: 0,
                descuento_retardo: 0
            };
        });

        if (asistenciasPorCrear.length > 0) {
            await prisma.asistencias.createMany({
                data: asistenciasPorCrear,
                skipDuplicates: true // Ignora si ya existen para evitar duplicados
            });
            console.log(`✅ Pre-carga finalizada: ${asistenciasPorCrear.length} registros.`);
        }
    } catch (error) {
        console.error("❌ Error en Cron Job:", error);
    }
});

// ============================================================
// 3. RUTAS DE EMPLEADOS
// ============================================================

app.get("/empleados", async (req, res) => {
    try {
        const empleados = await prisma.empleados.findMany();
        res.json(convertirBigInt(empleados));
    } catch (error) {
        res.status(500).json({ error: "Error obteniendo empleados" });
    }
});

app.post("/empleados", async (req, res) => {

    try {

        const nuevoEmpleado = await prisma.empleados.create({

            data: {

                // INFORMACION PERSONAL
                nombre: req.body.nombre,
                apellido_paterno: req.body.apellido_paterno,
                apellido_materno: req.body.apellido_materno,
                telefono: req.body.telefono || null,
                curp: req.body.curp || null,
                direccion: req.body.direccion || null,
                contacto_emerencia: req.body.contacto_emerencia || null,
                nacionalidad: req.body.nacionalidad || null,
                sexo: req.body.sexo || null,

                // FECHAS
                fecha_nacimiento: req.body.fecha_nacimiento
                    ? new Date(req.body.fecha_nacimiento)
                    : null,

                fecha_ingreso: req.body.fecha_ingreso
                    ? new Date(req.body.fecha_ingreso)
                    : null,

                fecha_vigencia: req.body.fecha_vigencia
                    ? new Date(req.body.fecha_vigencia)
                    : null,

                // RELACIONES
                departamento_id: req.body.departamento_id
                    ? BigInt(req.body.departamento_id)
                    : null,

                puesto_id: req.body.puesto_id
                    ? BigInt(req.body.puesto_id)
                    : null,

                // CONTRATO
                tipo_contrato: req.body.tipo_contrato || null,

                // ESTATUS
                activo: req.body.activo === "true"
                    ? true
                    : false,

                // PAGOS
                Tipo_Pago: req.body.Tipo_Pago || null,

                Pago_hora: req.body.Pago_hora
                    ? parseFloat(req.body.Pago_hora)
                    : null,

                Pago_diario: req.body.Pago_diario
                    ? parseFloat(req.body.Pago_diario)
                    : null,

                hora_programada_entrada:
                    req.body.hora_programada_entrada || null,

            }

        });

        res.json(convertirBigInt(nuevoEmpleado));

    } catch (error) {

        console.log(error);

        res.status(500).json({
            error: "Error creando empleado",
            detalle: error.message
        });

    }

});

// ==========================================
// ACTUALIZAR EMPLEADO
// ==========================================

app.put("/empleados/:id", async (req, res) => {

    try {

        const empleadoActualizado =
            await prisma.empleados.update({

                where: {
                    id_empleado: BigInt(req.params.id),
                },

                data: {

                    ...req.body,

                    fecha_nacimiento:
                        req.body.fecha_nacimiento
                            ? new Date(req.body.fecha_nacimiento)
                            : null,

                    fecha_ingreso:
                        req.body.fecha_ingreso
                            ? new Date(req.body.fecha_ingreso)
                            : null,

                    fecha_vigencia:
                        req.body.fecha_vigencia
                            ? new Date(req.body.fecha_vigencia)
                            : null,

                    departamento_id:
                        req.body.departamento_id
                            ? BigInt(req.body.departamento_id)
                            : null,

                    puesto_id:
                        req.body.puesto_id
                            ? BigInt(req.body.puesto_id)
                            : null,

                    Pago_hora:
                        req.body.Pago_hora
                            ? parseFloat(req.body.Pago_hora)
                            : null,

                    Pago_diario:
                        req.body.Pago_diario
                            ? parseFloat(req.body.Pago_diario)
                            : null,

                    activo:
                        Boolean(req.body.activo),

                },

            });

        res.json(convertirBigInt(empleadoActualizado));

    } catch (error) {

        console.log(error);

        res.status(500).json({
            error: "Error actualizando empleado"
        });

    }

});

// ==========================================
// OBTENER ASISTENCIAS POR FECHA
// ==========================================

app.get("/asistencias", async (req, res) => {

    try {

        const { fecha } = req.query;

        const asistencias =
            await prisma.asistencias.findMany({

                where: fecha
                    ? {
                        fecha: {
                            gte: new Date(fecha + "T00:00:00"),
                            lte: new Date(fecha + "T23:59:59"),
                        },
                    }
                    : undefined,

                include: {
                    empleados: true,
                },

                orderBy: {
                    hora_entrada: "asc",
                },

            });

        res.json(
            convertirBigInt(asistencias)
        );

    } catch (error) {

        console.log(error);

        res.status(500).json({
            error: "Error obteniendo asistencias"
        });

    }

});

// ============================================================
// 4. RUTAS DE ASISTENCIA Y JUSTIFICACIONES
// ============================================================

/**
 * ENTRADA: Registra hora, calcula retardo con 10min de tolerancia y marca PRESENTE.
 */
app.post("/asistencias", async (req, res) => {
    try {
        const { id_empleado, fecha, hora_entrada } = req.body;
        const empleado = await prisma.empleados.findUnique({ where: { id_empleado: BigInt(id_empleado) } });

        if (!empleado || !empleado.hora_programada_entrada) {
            return res.status(400).json({ error: "Empleado no encontrado o sin horario asignado" });
        }

        const entradaReal = convertirHoraAMinutos(hora_entrada);
        const entradaProg = convertirHoraAMinutos(empleado.hora_programada_entrada);
        let minutosRetardo = Math.max(0, entradaReal - entradaProg);
        
        // Regla: 10 min tolerancia, $1 por minuto excedente
        let descuentoRetardo = minutosRetardo > 10 ? (minutosRetardo - 10) * 1 : 0;
        const fechaBusqueda = new Date(fecha.split('T')[0] + "T00:00:00");

        const asistenciaAbierta = await prisma.asistencias.findFirst({
            where: { id_empleado: BigInt(id_empleado), fecha: fechaBusqueda, hora_salida: null }
        });

        if (asistenciaAbierta) {
            return res.status(400).json({ error: "Ya existe un periodo de asistencia abierto para este día. Marca salida antes de registrar una nueva entrada." });
        }

        const asistenciaPrevias = await prisma.asistencias.findFirst({
            where: { id_empleado: BigInt(id_empleado), fecha: fechaBusqueda }
        });

        if (asistenciaPrevias) {
            minutosRetardo = 0;
            descuentoRetardo = 0;
        }

        const asistenciaActualizada = await prisma.asistencias.create({
            data: {
                id_empleado: BigInt(id_empleado),
                fecha: fechaBusqueda,
                hora_entrada,
                minutos_retardo: minutosRetardo,
                descuento_retardo: descuentoRetardo,
                estatus: "PRESENTE"
            }
        });

        res.json(convertirBigInt(asistenciaActualizada));
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error en registro de entrada" });
    }
});

/**
 * SALIDA: Calcula horas trabajadas, sueldo del día y LO GUARDA EN NÓMINA (Alcancía)
 */
app.put("/asistencias/salida", async (req, res) => {
    try {
        const { id_empleado, fecha, hora_salida } = req.body;
        const fechaBusqueda = new Date(fecha.split('T')[0] + "T00:00:00");
        
        const asistencia = await prisma.asistencias.findFirst({
            where: { id_empleado: BigInt(id_empleado), fecha: fechaBusqueda, hora_salida: null },
            orderBy: { id_asistencia: "desc" },
            include: { empleados: true }
        });

        if (!asistencia) {
            return res.status(400).json({ error: "Asistencia no encontrada o salida ya marcada" });
        }

        // Calcular horas
        const entradaMin = convertirHoraAMinutos(asistencia.hora_entrada);
        const salidaMin = convertirHoraAMinutos(hora_salida);
        const horasTrabajadas = (Math.max(0, salidaMin - entradaMin) / 60).toFixed(2);

        // Actualizar Asistencia
        await prisma.asistencias.update({
            where: { id_asistencia: asistencia.id_asistencia },
            data: { hora_salida, horas_trabajadas: Number(horasTrabajadas) }
        });

        // Calcular dinero
        const emp = asistencia.empleados;
        let bruto = emp.Tipo_Pago?.toUpperCase() === "DIARIO"
                    ? Number(horasTrabajadas) * (emp.Pago_hora || 0)
                    : (emp.Pago_diario || 0);

        const neto = bruto - Number(asistencia.descuento_retardo || 0);

        // Acumular/actualizar nómina diaria para la misma fecha
        const nominaExistente = await prisma.nominas.findFirst({
            where: { id_empleado: BigInt(id_empleado), fecha_inicio: fechaBusqueda, estatus: "PENDIENTE" }
        });

        let recibo;
        if (nominaExistente) {
            const horasTotalesAcumuladas = Number(nominaExistente.horas_totales || 0) + Number(horasTrabajadas);
            const sueldoBrutoAcumulado = Number(nominaExistente.sueldo_bruto) + bruto;
            const totalRetardosAcumulados = Number(nominaExistente.total_descuentos_retardo || 0) + Number(asistencia.descuento_retardo || 0);

            const totalNetoActualizado = sueldoBrutoAcumulado
                + Number(nominaExistente.bonos || 0)
                + Number(nominaExistente.otras_percepciones || 0)
                - totalRetardosAcumulados
                - Number(nominaExistente.comidas || 0)
                - Number(nominaExistente.otras_deducciones || 0);

            recibo = await prisma.nominas.update({
                where: { id_nomina: nominaExistente.id_nomina },
                data: {
                    horas_totales: horasTotalesAcumuladas,
                    sueldo_bruto: sueldoBrutoAcumulado,
                    total_descuentos_retardo: totalRetardosAcumulados,
                    total_neto: totalNetoActualizado,
                    dias_trabajados: nominaExistente.dias_trabajados || 1,
                    fecha_fin: fechaBusqueda
                }
            });
        } else {
            recibo = await prisma.nominas.create({
                data: {
                    id_empleado: BigInt(id_empleado),
                    fecha_inicio: fechaBusqueda,
                    fecha_fin: fechaBusqueda,
                    dias_trabajados: 1,
                    horas_totales: Number(horasTrabajadas),
                    sueldo_bruto: bruto,
                    total_descuentos_retardo: asistencia.descuento_retardo || 0,
                    total_neto: neto,
                    estatus: "PENDIENTE"
                }
            });
        }

        res.json(convertirBigInt({
            mensaje: "¡Salida marcada y nómina diaria generada en PENDIENTE!",
            horas_registradas: horasTrabajadas,
            nomina_generada: recibo
        }));
    } catch (error) {
        console.error("Error al registrar salida y nómina:", error);
        res.status(500).json({ error: "Error en registro de salida" });
    }
});

/**
 * JUSTIFICAR FALTA: Limpia el expediente de RH, no genera pago.
 */
app.put("/asistencias/justificar", async (req, res) => {
    try {
        const { id_empleado, fecha, motivo } = req.body;
        const fechaBusqueda = new Date(fecha.split('T')[0] + "T00:00:00");

        const asistencia = await prisma.asistencias.findFirst({
            where: { id_empleado: BigInt(id_empleado), fecha: fechaBusqueda, estatus: "FALTA" }
        });

        if (!asistencia) return res.status(404).json({ error: "No se encontró una FALTA para justificar." });

        const actualizada = await prisma.asistencias.update({
            where: { id_asistencia: asistencia.id_asistencia },
            data: { estatus: "JUSTIFICADA" }
        });

        res.json({ mensaje: "Falta justificada correctamente", asistencia: convertirBigInt(actualizada) });
    } catch (error) {
        res.status(500).json({ error: "Error al justificar la falta" });
    }
});

// ============================================================
// 5. RUTAS DE NÓMINA E INCIDENCIAS
// ============================================================

/**
 * INCIDENCIAS: Agrega o quita dinero de un día específico y recalcula el total.
 */
app.post("/nominas/incidencias", async (req, res) => {
    try {
        const { id_empleado, fecha, tipo, concepto, monto } = req.body;
        const fechaBusqueda = new Date(fecha + "T00:00:00");

        const nomina = await prisma.nominas.findFirst({
            where: { id_empleado: BigInt(id_empleado), fecha_inicio: fechaBusqueda, estatus: "PENDIENTE" }
        });

        if (!nomina) return res.status(404).json({ error: "No hay nómina pendiente ese día." });

        let dataUpdate = {};
        const valorMonto = Number(monto);

        // Clasificar
        if (tipo === "PERCEPCION") {
            if (concepto.toUpperCase() === "BONO") dataUpdate.bonos = Number(nomina.bonos || 0) + valorMonto;
            else dataUpdate.otras_percepciones = Number(nomina.otras_percepciones || 0) + valorMonto;
        } else if (tipo === "DEDUCCION") {
            if (concepto.toUpperCase() === "COMIDA") dataUpdate.comidas = Number(nomina.comidas || 0) + valorMonto;
            else dataUpdate.otras_deducciones = Number(nomina.otras_deducciones || 0) + valorMonto;
        }

        // Recalcular Neto
        const bonosN = dataUpdate.bonos !== undefined ? dataUpdate.bonos : Number(nomina.bonos || 0);
        const perN = dataUpdate.otras_percepciones !== undefined ? dataUpdate.otras_percepciones : Number(nomina.otras_percepciones || 0);
        const comN = dataUpdate.comidas !== undefined ? dataUpdate.comidas : Number(nomina.comidas || 0);
        const dedN = dataUpdate.otras_deducciones !== undefined ? dataUpdate.otras_deducciones : Number(nomina.otras_deducciones || 0);

        dataUpdate.total_neto = Number(nomina.sueldo_bruto) + bonosN + perN - Number(nomina.total_descuentos_retardo || 0) - comN - dedN;

        const actualizada = await prisma.nominas.update({
            where: { id_nomina: nomina.id_nomina }, 
            data: dataUpdate
        });

        res.json({ mensaje: `Incidencia (${concepto}) aplicada.`, nomina_actualizada: convertirBigInt(actualizada) });
    } catch (error) {
        res.status(500).json({ error: "Error registrando la incidencia" });
    }
});

/**
 * ACUMULADO: Consulta rápida de cuánto se le debe al empleado (Alcancía)
 */
app.get("/nominas/acumulado/:id_empleado", async (req, res) => {
    try {
        const { id_empleado } = req.params;
        const pendientes = await prisma.nominas.findMany({
            where: { id_empleado: BigInt(id_empleado), estatus: "PENDIENTE" }
        });

        const total = pendientes.reduce((acc, n) => acc + Number(n.total_neto), 0);

        res.json(convertirBigInt({
            id_empleado,
            recibos_pendientes: pendientes.length,
            total_acumulado: total.toFixed(2),
            detalle: pendientes
        }));
    } catch (error) {
        res.status(500).json({ error: "Error obteniendo acumulados" });
    }
});

/**
 * IMPRIMIR Y PAGAR: Suma la alcancía, genera Word "El Sauce" y marca como PAGADO.
 */
app.post("/nominas/imprimir-y-pagar/:id_empleado", async (req, res) => {
    try {
        const { id_empleado } = req.params;

        const empleado = await prisma.empleados.findUnique({
            where: { id_empleado: BigInt(id_empleado) }
        });

        if (!empleado) return res.status(404).json({ error: "Empleado no encontrado" });

        let nombreDepto = "No asignado", nombrePuesto = "No asignado";
        if (empleado.departamento_id) {
            const depto = await prisma.departamentos.findUnique({ where: { id_departamento: empleado.departamento_id } });
            if (depto) nombreDepto = depto.nombre;
        }
        if (empleado.puesto_id) {
            const puesto = await prisma.puestos.findUnique({ where: { id_puestos: empleado.puesto_id } });
            if (puesto) nombrePuesto = puesto.nombre;
        }

        const pendientes = await prisma.nominas.findMany({
            where: { id_empleado: BigInt(id_empleado), estatus: "PENDIENTE" }
        });

        if (pendientes.length === 0) return res.status(400).json({ error: "No hay pagos pendientes." });

        let totalBruto = 0, totalRetardos = 0, totalNeto = 0, diasPagados = 0;
        let totalBonos = 0, totalComidas = 0, totalOtrasPercepciones = 0, totalOtrasDeducciones = 0;

        pendientes.forEach(p => {
            totalBruto += Number(p.sueldo_bruto);
            totalRetardos += Number(p.total_descuentos_retardo);
            totalBonos += Number(p.bonos || 0);
            totalComidas += Number(p.comidas || 0);
            totalOtrasPercepciones += Number(p.otras_percepciones || 0);
            totalOtrasDeducciones += Number(p.otras_deducciones || 0);
            totalNeto += Number(p.total_neto);
            diasPagados += Number(p.dias_trabajados);
        });

        if (empleado.Tipo_Pago?.toUpperCase() === "DIARIO") {
            diasPagados = pendientes.length;
        }

        const crearBloqueRecibo = () => {
            const sinBordes = {
                top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
                left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
                insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE }
            };

            return [
                new Paragraph({ children: [new TextRun({ text: "El Sauce Restaurante", bold: true, size: 28 })], alignment: AlignmentType.CENTER }),
                new Paragraph({ text: "Av. Tamaulipas #702 Col. Héroe de Nacozari", alignment: AlignmentType.CENTER }),
                new Paragraph({ text: "89520 Ciudad Madero Tamaulipas México", alignment: AlignmentType.CENTER }),
                new Paragraph({ children: [new TextRun({ text: "Recibo de Pago", bold: true, size: 24 })], alignment: AlignmentType.CENTER }),
                new Paragraph({ text: "" }),
                
                new Paragraph({ text: `Empleado: ${empleado.nombre} ${empleado.apellido_paterno} ${empleado.apellido_materno || ''}` }),
                new Paragraph({ text: `CURP: ${empleado.curp || 'No registrado'}` }),
                new Paragraph({ text: `Frecuencia de Pago: ${empleado.Tipo_Pago || 'No registrado'}` }),
                new Paragraph({ text: `Departamento: ${nombreDepto}` }),
                new Paragraph({ text: `Puesto: ${nombrePuesto}` }),
                new Paragraph({ text: `Dias Pagados: ${diasPagados}` }),
                new Paragraph({ text: `Fecha de Emision: ${new Date().toLocaleDateString('es-MX')}` }),
                new Paragraph({ text: "" }),

                new Table({
                    width: { size: 100, type: WidthType.PERCENTAGE }, borders: sinBordes,
                    rows: [
                        new TableRow({ children: [
                            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Percepciones:", bold: true })]})] }),
                            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Deducciones:", bold: true })]})] }),
                        ]}),
                        new TableRow({ children: [
                            new TableCell({ children: [new Paragraph(`Sueldo Bruto: $${totalBruto.toFixed(2)}`)] }),
                            new TableCell({ children: [new Paragraph(`Retardos: $${totalRetardos.toFixed(2)}`)] }),
                        ]}),
                        new TableRow({ children: [
                            new TableCell({ children: [new Paragraph(`Bonos: $${totalBonos.toFixed(2)}`)] }),
                            new TableCell({ children: [new Paragraph(`Comidas: $${totalComidas.toFixed(2)}`)] }),
                        ]}),
                        new TableRow({ children: [
                            new TableCell({ children: [new Paragraph(`Otros: $${totalOtrasPercepciones.toFixed(2)}`)] }),
                            new TableCell({ children: [new Paragraph(`Otros: $${totalOtrasDeducciones.toFixed(2)}`)] }),
                        ]}),
                    ],
                }),
                new Paragraph({ text: "" }),
                new Paragraph({ children: [new TextRun({ text: `Sueldo Neto: $${totalNeto.toFixed(2)}`, bold: true, size: 24 })] }),
                new Paragraph({ text: "" }),

                new Table({
                    width: { size: 100, type: WidthType.PERCENTAGE }, borders: sinBordes,
                    rows: [
                        new TableRow({ children: [
                            new TableCell({ children: [new Paragraph({ text: "_______________________________________", alignment: AlignmentType.CENTER })] }),
                            new TableCell({ children: [new Paragraph({ text: "_______________________________________", alignment: AlignmentType.CENTER })] }),
                        ]}),
                        new TableRow({ children: [
                            new TableCell({ children: [new Paragraph({ text: "Nombre y Firma del Empleado", alignment: AlignmentType.CENTER })] }),
                            new TableCell({ children: [new Paragraph({ text: "El Sauce Restaurante", alignment: AlignmentType.CENTER })] }),
                        ]}),
                    ]
                }),
                new Paragraph({ text: "" }),

                // --- TEXTO LEGAL EN 8pt ---
                new Paragraph({
                    children: [
                        new TextRun({
                            text: `"Recibí a mi entera satisfacción la cantidad neta que este recibo indica por concepto de salarios, séptimo día y prestaciones devengadas en el periodo señalado. Reconozco que con este pago queda cubierto el total de las percepciones a las que tengo derecho hasta la fecha, sin que se me adeude cantidad alguna por horas extra, descansos trabajados o cualquier otro concepto laboral, otorgando el finiquito más amplio que en derecho proceda respecto a este periodo."`,
                            size: 16, // 16 medios puntos = 8pt
                        }),
                    ],
                    alignment: AlignmentType.JUSTIFIED
                }),
            ];
        };

        const doc = new Document({
            styles: {
                default: {
                    document: { run: { size: 20, font: "Arial" } } // Regla de 10pt (20 medios puntos)
                }
            },
            sections: [{
                properties: {},
                children: [
                    ...crearBloqueRecibo(),
                    new Paragraph({ text: "" }),
                    new Paragraph({ text: "- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -", alignment: AlignmentType.CENTER }),
                    new Paragraph({ text: "" }),
                    ...crearBloqueRecibo()
                ],
            }],
        });

        const nombreArchivo = `Recibo_${empleado.nombre}_${Date.now()}.docx`;
        const buffer = await Packer.toBuffer(doc);
        fs.writeFileSync(nombreArchivo, buffer);

        await prisma.nominas.updateMany({
            where: { id_empleado: BigInt(id_empleado), estatus: "PENDIENTE" },
            data: { estatus: "PAGADO" }
        });

        res.json({
            mensaje: "Pago liquidado y recibo generado exitosamente.",
            archivo_generado: nombreArchivo,
            total_pagado: totalNeto.toFixed(2)
        });

    } catch (error) {
        console.error("Error imprimiendo formato:", error);
        res.status(500).json({ error: "Hubo un error generando tu recibo." });
    }
});

// ============================================================
// 6. LANZAMIENTO DEL SERVIDOR
// ============================================================
const PORT = 3001;
app.listen(PORT, () => {
    console.log(`
    🚀 Servidor de Nómina y Asistencia corriendo
    📍 Puerto: ${PORT}
    📅 Cron Job activo (Carga diaria 01:00 AM)
    `);
});