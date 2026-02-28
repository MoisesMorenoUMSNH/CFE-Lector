// ========================================
// SECCION 1: CONSTANTES
// ========================================

const STORAGE_KEY = 'cfe_recibos';

// Modo de subida actual: 'imagen' o 'pdf'
var modoSubida = null;

// Meses validos en espanol (para validar fechas del OCR)
var MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

// ========================================
// SECCION 2: FUNCIONES DE localStorage
// ========================================

function cargarRecibos() {
    const datos = localStorage.getItem(STORAGE_KEY);
    return datos ? JSON.parse(datos) : [];
}

function guardarRecibos(recibos) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recibos));
}

function existePeriodo(periodo) {
    const recibos = cargarRecibos();
    const normalizado = periodo.trim().toUpperCase().replace(/\s+/g, ' ');
    return recibos.some(function (r) {
        return r.periodo.trim().toUpperCase().replace(/\s+/g, ' ') === normalizado;
    });
}

// ========================================
// SECCION 3: FUNCIONES DEL MODAL
// ========================================

function abrirModal() {
    document.getElementById('modal_upload').style.display = 'flex';
    // Resetear estado del modal
    modoSubida = null;
    document.getElementById('selector_tipo').style.display = 'block';
    document.getElementById('campos_imagen').style.display = 'none';
    document.getElementById('campos_pdf').style.display = 'none';
    document.getElementById('btn_procesar').style.display = 'none';
    document.getElementById('imagen_frente').value = '';
    document.getElementById('imagen_reverso').value = '';
    document.getElementById('archivo_pdf').value = '';
    document.getElementById('btn_tipo_imagen').classList.remove('activo');
    document.getElementById('btn_tipo_pdf').classList.remove('activo');
    document.getElementById('pdf_contador').textContent = '';
    // Resetear zonas de drag & drop
    resetearZona('drop_frente');
    resetearZona('drop_reverso');
    resetearZona('drop_pdf');
    mostrarProgreso(false);
}

function seleccionarModo(modo) {
    modoSubida = modo;
    document.getElementById('btn_tipo_imagen').classList.toggle('activo', modo === 'imagen');
    document.getElementById('btn_tipo_pdf').classList.toggle('activo', modo === 'pdf');
    document.getElementById('campos_imagen').style.display = modo === 'imagen' ? 'block' : 'none';
    document.getElementById('campos_pdf').style.display = modo === 'pdf' ? 'block' : 'none';
    document.getElementById('btn_procesar').style.display = 'inline-flex';
}

function cerrarModal() {
    document.getElementById('modal_upload').style.display = 'none';
}

function mostrarProgreso(visible) {
    document.getElementById('ocr_progreso').style.display = visible ? 'block' : 'none';
    if (!visible) {
        document.getElementById('barra_llenado').style.width = '0%';
    }
}

function actualizarProgreso(mensaje, porcentaje) {
    document.getElementById('ocr_mensaje').textContent = mensaje;
    document.getElementById('barra_llenado').style.width = porcentaje + '%';
}

// ========================================
// SECCION 4: OCR CON TESSERACT.JS
// ========================================

async function ejecutarOCR(archivo, callbackProgreso) {
    var resultado = await Tesseract.recognize(archivo, 'spa', {
        logger: function (info) {
            if (info.status === 'recognizing text' && callbackProgreso) {
                callbackProgreso(info.progress * 100);
            }
        }
    });
    return resultado.data.text;
}

// Extrae texto de todas las paginas de un PDF usando PDF.js
async function extraerTextoPDF(archivo) {
    var arrayBuffer = await archivo.arrayBuffer();

    // Configurar worker de PDF.js
    pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

    var pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    var textos = [];

    for (var i = 1; i <= pdf.numPages; i++) {
        var pagina = await pdf.getPage(i);
        var contenido = await pagina.getTextContent();
        var textoPagina = contenido.items.map(function (item) {
            return item.str;
        }).join(' ');
        textos.push(textoPagina);
    }

    return textos;
}

async function procesarRecibo() {
    if (!modoSubida) {
        alert('Por favor selecciona el tipo de archivo (Imagenes o PDF).');
        return;
    }

    if (modoSubida === 'pdf') {
        await procesarReciboPDF();
    } else {
        await procesarReciboImagenes();
    }
}

// Procesar recibo desde imagenes (flujo original)
async function procesarReciboImagenes() {
    var archivoFrente = document.getElementById('imagen_frente').files[0];
    var archivoReverso = document.getElementById('imagen_reverso').files[0];

    if (!archivoFrente) {
        alert('Por favor selecciona la imagen del frente del recibo.');
        return;
    }

    mostrarProgreso(true);

    try {
        // OCR del frente
        actualizarProgreso('Leyendo imagen del frente...', 10);
        var textoFrente = await ejecutarOCR(archivoFrente, function (p) {
            actualizarProgreso('Leyendo frente...', 10 + p * 0.4);
        });
        console.log('=== TEXTO FRENTE (crudo) ===');
        console.log(textoFrente);

        // OCR del reverso
        var textoReverso = '';
        if (archivoReverso) {
            actualizarProgreso('Leyendo imagen del reverso...', 50);
            textoReverso = await ejecutarOCR(archivoReverso, function (p) {
                actualizarProgreso('Leyendo reverso...', 50 + p * 0.4);
            });
            console.log('=== TEXTO REVERSO (crudo) ===');
            console.log(textoReverso);
        }

        // Limpiar texto OCR antes de parsear
        var frenteLimpio = limpiarTextoOCR(textoFrente);
        var reversoLimpio = limpiarTextoOCR(textoReverso);
        console.log('=== TEXTO FRENTE (limpio) ===');
        console.log(frenteLimpio);
        console.log('=== TEXTO REVERSO (limpio) ===');
        console.log(reversoLimpio);

        // Parsear
        actualizarProgreso('Extrayendo datos...', 90);
        var datosFrente = parsearFrente(frenteLimpio);
        var datosReverso = parsearReverso(reversoLimpio);
        console.log('=== DATOS EXTRAIDOS ===');
        console.log('Frente:', datosFrente);
        console.log('Reverso:', datosReverso);

        // Pedir periodo manualmente si no se detecto
        if (!datosFrente.periodo) {
            var periodoManual = prompt('No se detecto el periodo del recibo.\nIngresalo manualmente (ej: 01 ENE 25 - 01 MAR 25):');
            if (!periodoManual) {
                mostrarProgreso(false);
                return;
            }
            datosFrente.periodo = periodoManual.trim().toUpperCase();
        }

        // Duplicados
        if (datosFrente.periodo && existePeriodo(datosFrente.periodo)) {
            alert('Ya existe un recibo para el periodo: ' + datosFrente.periodo);
            mostrarProgreso(false);
            return;
        }

        // Guardar recibo
        var recibo = {
            id: Date.now(),
            nombre: datosFrente.nombre || 'No detectado',
            direccion: datosFrente.direccion || '',
            noServicio: datosFrente.noServicio || '',
            periodo: datosFrente.periodo || 'No detectado',
            totalPagar: datosFrente.totalPagar || 0,
            kwhConsumidos: datosFrente.kwhConsumidos || 0,
            precioPorKwh: datosFrente.precioPorKwh || 0,
            lecturaActual: datosFrente.lecturaActual || 0,
            lecturaAnterior: datosFrente.lecturaAnterior || 0,
            historico: datosReverso.historico || [],
            fechaRegistro: new Date().toISOString().split('T')[0]
        };

        var recibos = cargarRecibos();
        recibos.push(recibo);
        guardarRecibos(recibos);

        actualizarProgreso('Listo!', 100);
        cerrarModal();
        renderizarRecibos();

    } catch (error) {
        console.error('Error OCR:', error);
        alert('Error al procesar las imagenes: ' + error.message);
        mostrarProgreso(false);
    }
}

// Procesar recibo desde PDF (soporta multiples archivos)
async function procesarReciboPDF() {
    var archivosPDF = document.getElementById('archivo_pdf').files;

    if (archivosPDF.length === 0) {
        alert('Por favor selecciona al menos un archivo PDF.');
        return;
    }

    mostrarProgreso(true);
    var totalArchivos = archivosPDF.length;
    var procesados = 0;
    var errores = [];

    try {
        for (var idx = 0; idx < totalArchivos; idx++) {
            var archivoPDF = archivosPDF[idx];
            var base = (idx / totalArchivos) * 100;
            var rango = 100 / totalArchivos;

            actualizarProgreso('Leyendo PDF ' + (idx + 1) + ' de ' + totalArchivos + '...', base + rango * 0.1);
            var paginas = await extraerTextoPDF(archivoPDF);
            console.log('=== PAGINAS DEL PDF ' + (idx + 1) + ' ===');
            paginas.forEach(function (p, i) {
                console.log('Pagina ' + (i + 1) + ':', p);
            });

            actualizarProgreso('Procesando texto (' + (idx + 1) + '/' + totalArchivos + ')...', base + rango * 0.5);

            var textoCompleto = paginas.join('\n');
            var textoFrente = paginas[0] || '';
            var textoReverso = paginas.length > 1 ? paginas.slice(1).join('\n') : '';

            var frenteLimpio = limpiarTextoOCR(textoFrente);
            var reversoLimpio = limpiarTextoOCR(textoReverso);

            actualizarProgreso('Extrayendo datos (' + (idx + 1) + '/' + totalArchivos + ')...', base + rango * 0.8);
            var datosFrente = parsearFrente(frenteLimpio);

            if (!datosFrente.periodo || !datosFrente.totalPagar) {
                var datosCompleto = parsearFrente(limpiarTextoOCR(textoCompleto));
                if (!datosFrente.periodo && datosCompleto.periodo) datosFrente.periodo = datosCompleto.periodo;
                if (!datosFrente.totalPagar && datosCompleto.totalPagar) datosFrente.totalPagar = datosCompleto.totalPagar;
                if (!datosFrente.nombre && datosCompleto.nombre) datosFrente.nombre = datosCompleto.nombre;
                if (!datosFrente.noServicio && datosCompleto.noServicio) datosFrente.noServicio = datosCompleto.noServicio;
                if (!datosFrente.direccion && datosCompleto.direccion) datosFrente.direccion = datosCompleto.direccion;
                if (!datosFrente.kwhConsumidos && datosCompleto.kwhConsumidos) datosFrente.kwhConsumidos = datosCompleto.kwhConsumidos;
                if (!datosFrente.precioPorKwh && datosCompleto.precioPorKwh) datosFrente.precioPorKwh = datosCompleto.precioPorKwh;
                if (!datosFrente.lecturaActual && datosCompleto.lecturaActual) datosFrente.lecturaActual = datosCompleto.lecturaActual;
                if (!datosFrente.lecturaAnterior && datosCompleto.lecturaAnterior) datosFrente.lecturaAnterior = datosCompleto.lecturaAnterior;
            }

            var datosReverso = parsearReverso(reversoLimpio);
            if (datosReverso.historico.length === 0) {
                datosReverso = parsearReverso(limpiarTextoOCR(textoCompleto));
            }

            console.log('=== DATOS EXTRAIDOS (PDF ' + (idx + 1) + ') ===');
            console.log('Frente:', datosFrente);
            console.log('Reverso:', datosReverso);

            // Pedir periodo manualmente si no se detecto
            if (!datosFrente.periodo) {
                var periodoManual = prompt('No se detecto el periodo del PDF "' + archivoPDF.name + '".\nIngresalo manualmente (ej: 01 ENE 25 - 01 MAR 25):');
                if (!periodoManual) {
                    errores.push(archivoPDF.name + ': periodo no ingresado, omitido');
                    continue;
                }
                datosFrente.periodo = periodoManual.trim().toUpperCase();
            }

            // Duplicados
            if (datosFrente.periodo && existePeriodo(datosFrente.periodo)) {
                errores.push(archivoPDF.name + ': ya existe periodo ' + datosFrente.periodo);
                continue;
            }

            // Guardar recibo
            var recibo = {
                id: Date.now() + idx,
                nombre: datosFrente.nombre || 'No detectado',
                direccion: datosFrente.direccion || '',
                noServicio: datosFrente.noServicio || '',
                periodo: datosFrente.periodo || 'No detectado',
                totalPagar: datosFrente.totalPagar || 0,
                kwhConsumidos: datosFrente.kwhConsumidos || 0,
                precioPorKwh: datosFrente.precioPorKwh || 0,
                lecturaActual: datosFrente.lecturaActual || 0,
                lecturaAnterior: datosFrente.lecturaAnterior || 0,
                historico: datosReverso.historico || [],
                fechaRegistro: new Date().toISOString().split('T')[0]
            };

            var recibos = cargarRecibos();
            recibos.push(recibo);
            guardarRecibos(recibos);
            procesados++;
        }

        actualizarProgreso('Listo!', 100);

        if (errores.length > 0) {
            alert('Se procesaron ' + procesados + ' de ' + totalArchivos + ' PDFs.\n\nOmitidos:\n' + errores.join('\n'));
        }

        cerrarModal();
        renderizarRecibos();

    } catch (error) {
        console.error('Error PDF:', error);
        alert('Error al procesar el PDF: ' + error.message);
        mostrarProgreso(false);
    }
}

// ========================================
// SECCION 5: LIMPIEZA DE TEXTO OCR
// ========================================

// Corrige errores comunes del OCR antes de parsear
function limpiarTextoOCR(texto) {
    var t = texto;

    // Reemplazar em-dashes y en-dashes con espacios (el OCR los pone entre datos)
    t = t.replace(/[—–]/g, ' ');

    // Corregir meses con 0 en vez de O: 0CT→OCT, 0IC→DIC
    t = t.replace(/0CT/g, 'OCT');
    t = t.replace(/0ct/g, 'oct');
    t = t.replace(/0IC/g, 'DIC');
    t = t.replace(/0ic/g, 'dic');
    t = t.replace(/D1C/g, 'DIC');
    t = t.replace(/d1c/g, 'dic');

    // Separar fechas pegadas: "ABRZS" → "ABR 25", "JUNZS" → "JUN 25"
    // Z=2, S=5 son errores comunes del OCR
    t = t.replace(/([A-Z]{3})ZS\b/g, '$1 25');
    t = t.replace(/([A-Z]{3})Z4\b/g, '$1 24');
    t = t.replace(/([A-Z]{3})Z3\b/g, '$1 23');

    // Separar numeros pegados a meses: "05ABR24" → "05 ABR 24"
    t = t.replace(/(\d{2})([A-Z]{3})(\d{2})/g, '$1 $2 $3');

    // Separar "07,OCT25" → "07 OCT 25" (coma como separador)
    t = t.replace(/(\d{2})[,.]([A-Z]{3})(\d{2})/g, '$1 $2 $3');

    // Limpiar multiples espacios
    t = t.replace(/  +/g, ' ');

    return t;
}

// ========================================
// SECCION 6: PARSEO DE TEXTO (REGEX)
// ========================================

// Extrae datos del frente del recibo
function parsearFrente(texto) {
    var resultado = {
        nombre: null,
        direccion: null,
        noServicio: null,
        periodo: null,
        totalPagar: null,
        kwhConsumidos: null,
        precioPorKwh: null,
        lecturaActual: null,
        lecturaAnterior: null
    };

    var t = texto;
    var lineas = t.split('\n');

    // --- Funcion auxiliar: limpiar texto de columna derecha que OCR mezcla ---
    // El OCR a veces junta la columna izquierda (datos personales) con la derecha
    // (TOTAL A PAGAR, DESCARGA APP, etc.) en una sola linea
    function limpiarColumna(linea) {
        var l = linea;
        l = l.replace(/TOTAL\s*A\s*PAGAR.*$/i, '');
        l = l.replace(/DESCARGA.*$/i, '');
        l = l.replace(/\$\s*\d[\d,.]*\s*(PESOS|MXN|M\.N\.)?.*$/i, '');
        l = l.replace(/\(DOSCIENTOS.*$/i, '');
        return l.trim();
    }

    // --- NOMBRE DEL BENEFICIARIO ---
    // Estrategia 1: linea con al menos 2 palabras en mayusculas, limpiando columna derecha
    var palabrasExcluir = /\b(CFE|COMISI|FEDERAL|ELECTRICIDAD|CONCEPTO|ENERGIA|BASICO|PERIODO|LECTURA|MEDID|TARIFA|LIMITE|CORTE|DESCARGA|MERCADO|MAYORISTA|DESGLOSE|IMPORTE|SUBTOTAL|PRECIO|ESTIMAD|SERVICIO|MULTIPLICAD|FACTURAD|PAGO)\b/i;
    for (var i = 0; i < lineas.length; i++) {
        var linea = limpiarColumna(lineas[i].trim());
        // Extraer solo la parte de letras mayusculas y espacios
        var soloLetras = linea.replace(/[^A-ZÁÉÍÓÚÑ\s]/g, '').replace(/\s+/g, ' ').trim();
        if (soloLetras.length >= 8 && soloLetras.split(' ').length >= 2) {
            if (!palabrasExcluir.test(soloLetras)) {
                resultado.nombre = soloLetras;
                break;
            }
        }
    }
    // Estrategia 2: buscar nombre en la linea justo arriba de la primera linea de direccion
    if (!resultado.nombre) {
        for (var i = 1; i < lineas.length; i++) {
            if (/\b(AV\b|CALLE|C\.?P\.?\s*\d|CANTERA|VILLAS)/i.test(lineas[i])) {
                var candidato = limpiarColumna(lineas[i - 1].trim());
                candidato = candidato.replace(/[^A-ZÁÉÍÓÚÑ\s]/g, '').replace(/\s+/g, ' ').trim();
                if (candidato.length >= 5 && candidato.split(' ').length >= 2) {
                    if (!palabrasExcluir.test(candidato)) {
                        resultado.nombre = candidato;
                        break;
                    }
                }
            }
        }
    }

    // --- NO. DE SERVICIO ---
    var mServ = t.match(/NO\.?\s*(?:DE\s*)?SERVICIO\s*:?\s*([\d\s]{8,})/i);
    if (mServ) {
        resultado.noServicio = mServ[1].replace(/\s/g, '');
    }
    // Fallback: buscar "SERVICIO" seguido de un numero largo
    if (!resultado.noServicio) {
        var mServ2 = t.match(/SERVICIO[\s\S]{0,30}?(\d{10,15})/i);
        if (mServ2) resultado.noServicio = mServ2[1];
    }
    // Fallback: buscar un numero de 12 digitos aislado
    if (!resultado.noServicio) {
        var mServ3 = t.match(/\b(\d{12})\b/);
        if (mServ3) resultado.noServicio = mServ3[1];
    }

    // --- DIRECCION ---
    // Buscar lineas con patrones de direccion, limpiando texto de columna derecha
    for (var i = 0; i < lineas.length; i++) {
        var linea = limpiarColumna(lineas[i].trim());
        if (linea.length < 3) continue;
        if (/\b(AV\b|CALLE|C\.?P\.?\s*\d|CANTERA|VILLAS|COL\b|FRA\b|FRACC|COLONIA|PEDREGAL|MORELIA|MICH)/i.test(linea)) {
            if (!resultado.direccion) resultado.direccion = linea;
            else resultado.direccion += ', ' + linea;
        }
    }

    // --- PERIODO FACTURADO ---
    // Buscar patron de dos fechas DD MMM YY separadas por guion
    var mp = t.match(/(\d{1,2}\s+[A-Z]{3}\s+\d{2})\s*[-~]\s*(\d{1,2}\s+[A-Z]{3}\s+\d{2})/i);
    if (mp) {
        // Validar que los meses sean reales
        var mes1 = mp[1].match(/[A-Z]{3}/i);
        var mes2 = mp[2].match(/[A-Z]{3}/i);
        if (mes1 && mes2 && MESES.indexOf(mes1[0].toUpperCase()) !== -1 && MESES.indexOf(mes2[0].toUpperCase()) !== -1) {
            resultado.periodo = mp[1].trim().toUpperCase() + ' - ' + mp[2].trim().toUpperCase();
        }
    }
    // Fallback: buscar "Corte a partir" en el texto completo (frente + reverso se procesan separado)
    if (!resultado.periodo) {
        var mc = t.match(/Corte\s+a\s+partir\s+\w+\s+(\d{1,2}\s+[A-Z]{3}\s+\d{2})/i);
        if (mc) {
            resultado.periodo = 'Hasta ' + mc[1].trim().toUpperCase();
        }
    }

    // --- TOTAL A PAGAR ---
    // Primero buscar "Total $NNN.NN" en la tabla de desglose (mas preciso)
    var mt1 = t.match(/\bTotal\s+\$\s*([\d,.]+)/i);
    if (mt1) {
        resultado.totalPagar = parseFloat(mt1[1].replace(/,/g, ''));
    }
    // Fallback: buscar "$NNN" cerca de "PESOS"
    if (!resultado.totalPagar) {
        var mt2 = t.match(/\$([\d,.]+)[\s\S]{0,80}PESOS/i);
        if (mt2) resultado.totalPagar = parseFloat(mt2[1].replace(/,/g, ''));
    }
    // Fallback: buscar "TOTAL A PAGAR" con monto
    if (!resultado.totalPagar) {
        var mt3 = t.match(/TOTAL\s*A\s*PAGAR[\s\S]{0,60}\$\s*([\d,.]+)/i);
        if (mt3) resultado.totalPagar = parseFloat(mt3[1].replace(/,/g, ''));
    }

    // --- kWh CONSUMIDOS Y LECTURAS ---
    // Buscar "Energia (kWh)" o "Energia (KW)" seguido de lecturas
    var me = t.match(/Energ[iíÍ]a\s*\(?\s*k\s*w\s*h?\s*\)?\s*0*(\d{2,5})\s+0*(\d{2,5})\s+(\d{1,4})/i);
    if (me) {
        var l1 = parseInt(me[1]);
        var l2 = parseInt(me[2]);
        var consumo = parseInt(me[3]);
        resultado.lecturaActual = Math.max(l1, l2);
        resultado.lecturaAnterior = Math.min(l1, l2);
        resultado.kwhConsumidos = consumo;
    }
    // Fallback: buscar "Suma" + numero
    if (!resultado.kwhConsumidos) {
        var ms = t.match(/\bSuma\s+(\d{1,4})\b/i);
        if (ms) resultado.kwhConsumidos = parseInt(ms[1]);
    }

    // --- PRECIO POR kWh ---
    // Buscar en fila "Basico": numero decimal entre 0 y 10
    var mpr = t.match(/[BbÁá][áaÁ]sico\s+\d+\s+([\d]+\.[\d]{2,})/i);
    if (mpr) {
        var val = parseFloat(mpr[1]);
        if (val > 0 && val < 10) resultado.precioPorKwh = val;
    }
    // Fallback: buscar patron N.NNN seguido de NNN.NN (precio + subtotal)
    if (!resultado.precioPorKwh) {
        var mpr2 = t.match(/(\d\.\d{3})\s+\d+\.\d{2}/);
        if (mpr2) {
            var v = parseFloat(mpr2[1]);
            if (v > 0 && v < 10) resultado.precioPorKwh = v;
        }
    }

    return resultado;
}

// Extrae la tabla de consumo historico del reverso
function parsearReverso(texto) {
    var resultado = { historico: [] };
    if (!texto) return resultado;

    var lineas = texto.split('\n');

    for (var i = 0; i < lineas.length; i++) {
        var linea = lineas[i];

        // Contar cuantos meses validos tiene esta linea
        var mesesEnLinea = 0;
        for (var m = 0; m < MESES.length; m++) {
            if (linea.toUpperCase().indexOf(MESES[m]) !== -1) mesesEnLinea++;
        }
        // Las filas del historico tienen al menos 1 mes
        if (mesesEnLinea === 0) continue;

        // Buscar todas las fechas en la linea: DD MMM YY (con separadores flexibles)
        var fechas = [];
        var regexFecha = /(\d{1,2})\s*[,.\s]*([A-Z]{3})\s*[,.\s]*(\d{2})/gi;
        var mf;
        while ((mf = regexFecha.exec(linea)) !== null) {
            var mes = mf[2].toUpperCase();
            if (MESES.indexOf(mes) !== -1) {
                fechas.push(mf[1] + ' ' + mes + ' ' + mf[3]);
            }
        }

        // Necesitamos al menos 2 fechas para un periodo
        if (fechas.length < 2) continue;

        // Buscar kWh: numero de 2-3 digitos que no sea parte de una fecha o precio
        // Buscar el primer numero aislado de 2-3 digitos despues de las fechas
        var kwhMatch = linea.match(/\b(\d{2,3})\b/g);
        var kwh = 0;
        if (kwhMatch) {
            for (var k = 0; k < kwhMatch.length; k++) {
                var n = parseInt(kwhMatch[k]);
                // Excluir numeros que son parte de fechas (dias: 01-31, anos: 23-26)
                if (n >= 20 && n <= 500) {
                    // Verificar que no es un dia o ano de fecha
                    var esParteDeFecha = false;
                    for (var f = 0; f < fechas.length; f++) {
                        if (fechas[f].indexOf(kwhMatch[k]) !== -1) {
                            esParteDeFecha = true;
                            break;
                        }
                    }
                    if (!esParteDeFecha) {
                        kwh = n;
                        break;
                    }
                }
            }
        }

        // Buscar importe: primer monto con $ o numero con formato NNN.NN
        var importeMatch = linea.match(/\$([\d,.]+)/);
        var importe = 0;
        if (importeMatch) {
            importe = parseFloat(importeMatch[1].replace(/,/g, ''));
        }

        if (kwh > 0) {
            resultado.historico.push({
                periodo: fechas[0] + ' - ' + fechas[1],
                kwh: kwh,
                importe: importe
            });
        }
    }

    return resultado;
}

// ========================================
// SECCION 7: ESTADISTICAS
// ========================================

function calcularEstadisticas(historico) {
    if (historico.length === 0) {
        return { promedio: 0, minimo: 0, maximo: 0, tendencia: 'Sin datos' };
    }

    var valores = historico.map(function (h) { return h.kwh; });
    var suma = valores.reduce(function (a, b) { return a + b; }, 0);
    var promedio = Math.round(suma / valores.length);
    var minimo = Math.min.apply(null, valores);
    var maximo = Math.max.apply(null, valores);

    var tendencia = 'Estable';
    if (valores.length >= 2) {
        if (valores[0] > valores[1]) tendencia = 'Subiendo';
        else if (valores[0] < valores[1]) tendencia = 'Bajando';
    }

    return { promedio: promedio, minimo: minimo, maximo: maximo, tendencia: tendencia };
}

// ========================================
// SECCION 8: RENDERIZADO DE TARJETAS
// ========================================

var MAX_RECIBOS_VISIBLE = 5;

function renderizarRecibos() {
    var contenedor = document.getElementById('contenedor_recibos');
    var recibos = cargarRecibos();
    var barra = document.getElementById('barra_recibos');

    contenedor.innerHTML = '';

    if (recibos.length === 0) {
        contenedor.innerHTML = '<p class="mensaje_vacio">No hay recibos guardados.</p>';
        barra.style.display = 'none';
        return;
    }

    // Mostrar barra con total de recibos
    document.getElementById('total_recibos').textContent = 'Total recibos: ' + recibos.length;
    barra.style.display = 'flex';

    // Mostrar solo los primeros MAX_RECIBOS_VISIBLE
    var visibles = recibos.slice(0, MAX_RECIBOS_VISIBLE);
    visibles.forEach(function (recibo) {
        var tarjeta = crearTarjeta(recibo);
        contenedor.appendChild(tarjeta);
    });

    // Si hay mas, mostrar boton "Ver mas recibos"
    if (recibos.length > MAX_RECIBOS_VISIBLE) {
        var restantes = recibos.length - MAX_RECIBOS_VISIBLE;
        var btnVerMas = document.createElement('button');
        btnVerMas.className = 'btn_ver_mas';
        btnVerMas.textContent = 'Ver mas recibos (' + restantes + ' restantes)';
        btnVerMas.addEventListener('click', abrirModalTodos);
        contenedor.appendChild(btnVerMas);
    }
}

function abrirModalTodos() {
    var modal = document.getElementById('modal_todos');
    var contenedor = document.getElementById('contenedor_todos');
    var recibos = cargarRecibos();

    contenedor.innerHTML = '';
    recibos.forEach(function (recibo) {
        var tarjeta = crearTarjeta(recibo);
        contenedor.appendChild(tarjeta);
    });

    modal.style.display = 'flex';
}

function cerrarModalTodos() {
    document.getElementById('modal_todos').style.display = 'none';
}

function crearTarjeta(recibo) {
    var tarjeta = document.createElement('div');
    tarjeta.className = 'tarjeta_recibo';

    var html = '';

    // Header colapsable: periodo + total + flecha + eliminar (siempre visible)
    html += '<div class="tarjeta_header">'
        + '<div class="tarjeta_resumen">'
        + '<span class="tarjeta_flecha">&#9654;</span>'
        + '<h3>' + recibo.periodo + '</h3>'
        + '<span class="tarjeta_total">$' + recibo.totalPagar.toFixed(2) + '</span>'
        + '</div>'
        + '<button class="btn_eliminar" data-id="' + recibo.id + '">Eliminar</button>'
        + '</div>';

    // Contenido desplegable (oculto por defecto)
    html += '<div class="tarjeta_contenido">';

    // Datos del beneficiario
    var tieneDatos = (recibo.nombre && recibo.nombre !== 'No detectado')
        || recibo.direccion || recibo.noServicio;
    if (tieneDatos) {
        html += '<div class="datos_beneficiario">';
        if (recibo.nombre && recibo.nombre !== 'No detectado') {
            html += '<p><strong>' + recibo.nombre + '</strong></p>';
        }
        if (recibo.direccion) html += '<p>' + recibo.direccion + '</p>';
        if (recibo.noServicio) html += '<p>No. Servicio: ' + recibo.noServicio + '</p>';
        html += '</div>';
    }

    // Datos clave
    html += '<div class="datos_clave">'
        + crearDato('TOTAL A PAGAR', '$' + recibo.totalPagar.toFixed(2))
        + crearDato('CONSUMO', recibo.kwhConsumidos + ' kWh')
        + crearDato('PRECIO/kWh', '$' + recibo.precioPorKwh.toFixed(3))
        + crearDato('LECTURA ACTUAL', recibo.lecturaActual)
        + '</div>';

    // Grafica, tabla y estadisticas
    if (recibo.historico && recibo.historico.length > 0) {
        html += '<div class="contenedor_grafico">'
            + '<canvas id="chart_' + recibo.id + '"></canvas></div>';

        html += '<table class="tabla_historico"><thead><tr>'
            + '<th>Periodo</th><th>kWh</th><th>Importe</th>'
            + '</tr></thead><tbody>';
        recibo.historico.forEach(function (h) {
            html += '<tr><td>' + h.periodo + '</td>'
                + '<td>' + h.kwh + '</td>'
                + '<td>' + (h.importe > 0 ? '$' + h.importe.toFixed(2) : '-') + '</td></tr>';
        });
        html += '</tbody></table>';

        var stats = calcularEstadisticas(recibo.historico);
        html += '<div class="estadisticas">'
            + crearStat('PROMEDIO', stats.promedio + ' kWh')
            + crearStat('MINIMO', stats.minimo + ' kWh')
            + crearStat('MAXIMO', stats.maximo + ' kWh')
            + crearStat('TENDENCIA', stats.tendencia)
            + '</div>';
    }

    html += '</div>'; // cierra tarjeta_contenido

    tarjeta.innerHTML = html;

    // Evento toggle colapsar/expandir
    var header = tarjeta.querySelector('.tarjeta_header');
    header.addEventListener('click', function (e) {
        // No colapsar si se hizo click en el boton eliminar
        if (e.target.closest('.btn_eliminar')) return;
        tarjeta.classList.toggle('expandida');

        // Renderizar grafica la primera vez que se expande
        if (tarjeta.classList.contains('expandida') && recibo.historico && recibo.historico.length > 0) {
            var canvas = tarjeta.querySelector('#chart_' + recibo.id);
            if (canvas && !canvas.getAttribute('data-rendered')) {
                canvas.setAttribute('data-rendered', 'true');
                setTimeout(function () {
                    renderizarGrafico('chart_' + recibo.id, recibo.historico);
                }, 100);
            }
        }
    });

    // Evento eliminar
    var btnEliminar = tarjeta.querySelector('.btn_eliminar');
    if (btnEliminar) {
        btnEliminar.addEventListener('click', function () {
            eliminarRecibo(recibo.id);
        });
    }

    return tarjeta;
}

function crearDato(etiqueta, valor) {
    return '<div class="dato_item">'
        + '<div class="dato_etiqueta">' + etiqueta + '</div>'
        + '<div class="dato_valor">' + valor + '</div></div>';
}

function crearStat(etiqueta, valor) {
    return '<div class="stat_item">'
        + '<div class="stat_etiqueta">' + etiqueta + '</div>'
        + '<div class="stat_valor">' + valor + '</div></div>';
}

function eliminarRecibo(id) {
    if (!confirm('Eliminar este recibo?')) return;
    var recibos = cargarRecibos();
    recibos = recibos.filter(function (r) { return r.id !== id; });
    guardarRecibos(recibos);
    renderizarRecibos();

    // Actualizar popup si esta abierto
    var modal = document.getElementById('modal_todos');
    if (modal.style.display !== 'none') {
        if (recibos.length === 0) {
            cerrarModalTodos();
        } else {
            abrirModalTodos();
        }
    }
}

function eliminarTodos() {
    var recibos = cargarRecibos();
    if (recibos.length === 0) return;
    if (!confirm('Eliminar todos los recibos (' + recibos.length + ')? Esta accion no se puede deshacer.')) return;
    guardarRecibos([]);
    renderizarRecibos();
}

// ========================================
// SECCION 9: GRAFICAS CON CHART.JS
// ========================================

function renderizarGrafico(canvasId, historico) {
    var ctx = document.getElementById(canvasId);
    if (!ctx || historico.length === 0) return;

    var datos = historico.slice().reverse();

    var etiquetas = datos.map(function (h) {
        var partes = h.periodo.split(' - ');
        return partes[1] ? partes[1].trim() : h.periodo;
    });

    var valoresKwh = datos.map(function (h) { return h.kwh; });

    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: etiquetas,
            datasets: [{
                label: 'Consumo (kWh)',
                data: valoresKwh,
                backgroundColor: '#91d9ff',
                borderColor: '#adcfe5',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: { color: '#fff', font: { family: 'Courier New' } }
                }
            },
            scales: {
                x: { ticks: { color: '#adcfe5', font: { size: 10 } } },
                y: {
                    beginAtZero: true,
                    ticks: { color: '#adcfe5' },
                    title: { display: true, text: 'kWh', color: '#fff' }
                }
            }
        }
    });
}

// ========================================
// SECCION 10: CALCULOS (MEDIA Y VARIANZA)
// ========================================

// Variables para las instancias de Chart.js (para destruir antes de re-crear)
var chartMediaInstancia = null;
var chartVarianzaInstancia = null;

function calcularMedia() {
    var recibos = cargarRecibos();
    if (recibos.length === 0) {
        alert('No hay recibos para calcular. Agrega al menos un recibo.');
        return;
    }

    var valores = recibos.map(function (r) { return r.totalPagar; });
    var n = valores.length;
    var suma = valores.reduce(function (a, b) { return a + b; }, 0);
    var media = suma / n;

    // Mostrar formula y resultado
    var textoValores = valores.map(function (v) { return '$' + v.toFixed(2); }).join(' + ');
    document.getElementById('formula_media').innerHTML =
        'Media = ( ' + textoValores + ' ) / ' + n
        + '<br>Media = $' + suma.toFixed(2) + ' / ' + n;
    document.getElementById('valor_media').textContent = 'Media = $' + media.toFixed(2);

    // Mostrar panel
    document.getElementById('panel_media').style.display = 'block';

    // Renderizar grafica
    var etiquetas = recibos.map(function (r) { return r.periodo; });
    var mediaArray = valores.map(function () { return media; });

    // Destruir grafica previa si existe
    if (chartMediaInstancia) {
        chartMediaInstancia.destroy();
        chartMediaInstancia = null;
    }

    var ctx = document.getElementById('chart_media');
    chartMediaInstancia = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: etiquetas,
            datasets: [
                {
                    label: 'Total a Pagar ($)',
                    data: valores,
                    backgroundColor: '#91d9ff',
                    borderColor: '#adcfe5',
                    borderWidth: 1,
                    order: 2
                },
                {
                    label: 'Media ($' + media.toFixed(2) + ')',
                    data: mediaArray,
                    type: 'line',
                    borderColor: '#6bffb8',
                    borderWidth: 2,
                    borderDash: [8, 4],
                    pointBackgroundColor: '#6bffb8',
                    pointRadius: 3,
                    fill: false,
                    order: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: { color: '#fff', font: { family: 'Courier New' } }
                }
            },
            scales: {
                x: { ticks: { color: '#adcfe5', font: { size: 10 }, maxRotation: 45 } },
                y: {
                    beginAtZero: true,
                    ticks: { color: '#adcfe5' },
                    title: { display: true, text: 'Pesos ($)', color: '#fff' }
                }
            }
        }
    });
}

function calcularVarianza() {
    var recibos = cargarRecibos();
    if (recibos.length === 0) {
        alert('No hay recibos para calcular. Agrega al menos un recibo.');
        return;
    }

    var valores = recibos.map(function (r) { return r.totalPagar; });
    var n = valores.length;
    var suma = valores.reduce(function (a, b) { return a + b; }, 0);
    var media = suma / n;

    // Calcular desviaciones al cuadrado
    var desviaciones = valores.map(function (v) {
        return Math.pow(v - media, 2);
    });
    var sumaDesviaciones = desviaciones.reduce(function (a, b) { return a + b; }, 0);
    var varianza = sumaDesviaciones / n;

    // Mostrar formula y resultado
    var textoDesv = valores.map(function (v) {
        return '($' + v.toFixed(2) + ' - $' + media.toFixed(2) + ')²';
    }).join(' + ');
    document.getElementById('formula_varianza').innerHTML =
        'Media = $' + media.toFixed(2)
        + '<br>Varianza = [ ' + textoDesv + ' ] / ' + n
        + '<br>Varianza = $' + sumaDesviaciones.toFixed(2) + ' / ' + n;
    document.getElementById('valor_varianza').textContent = 'Varianza = $' + varianza.toFixed(2);

    // Mostrar panel
    document.getElementById('panel_varianza').style.display = 'block';

    // Renderizar grafica: barras con (xi - media)^2
    var etiquetas = recibos.map(function (r) { return r.periodo; });

    // Destruir grafica previa si existe
    if (chartVarianzaInstancia) {
        chartVarianzaInstancia.destroy();
        chartVarianzaInstancia = null;
    }

    var ctx = document.getElementById('chart_varianza');
    chartVarianzaInstancia = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: etiquetas,
            datasets: [{
                label: 'Desviacion² (xi - media)²',
                data: desviaciones,
                backgroundColor: desviaciones.map(function (d) {
                    // Color mas intenso para desviaciones grandes
                    var max = Math.max.apply(null, desviaciones);
                    var intensidad = max > 0 ? d / max : 0;
                    var r = Math.round(145 + intensidad * 60);
                    var g = Math.round(217 - intensidad * 120);
                    var b = 255;
                    return 'rgba(' + r + ', ' + g + ', ' + b + ', 0.8)';
                }),
                borderColor: '#adcfe5',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: { color: '#fff', font: { family: 'Courier New' } }
                }
            },
            scales: {
                x: { ticks: { color: '#adcfe5', font: { size: 10 }, maxRotation: 45 } },
                y: {
                    beginAtZero: true,
                    ticks: { color: '#adcfe5' },
                    title: { display: true, text: '(xi - media)²', color: '#fff' }
                }
            }
        }
    });
}

// ========================================
// SECCION 11: DRAG & DROP
// ========================================

// Configura drag & drop para una zona dada
function configurarDropZone(zonaId, inputId, multiple) {
    var zona = document.getElementById(zonaId);
    var input = document.getElementById(inputId);
    if (!zona || !input) return;

    // Click en la zona abre el selector de archivos
    zona.addEventListener('click', function (e) {
        if (e.target === input) return;
        input.click();
    });

    // Feedback visual al arrastrar
    zona.addEventListener('dragover', function (e) {
        e.preventDefault();
        zona.classList.add('dragover');
    });
    zona.addEventListener('dragleave', function () {
        zona.classList.remove('dragover');
    });

    // Soltar archivos
    zona.addEventListener('drop', function (e) {
        e.preventDefault();
        zona.classList.remove('dragover');
        var archivos = e.dataTransfer.files;
        if (archivos.length === 0) return;

        if (multiple) {
            // Para PDF: agregar archivos al input (no se puede setear .files directamente con append,
            // asi que usamos un DataTransfer para combinar)
            var dt = new DataTransfer();
            // Mantener archivos previos
            for (var i = 0; i < input.files.length; i++) {
                dt.items.add(input.files[i]);
            }
            // Agregar nuevos (solo PDFs)
            for (var i = 0; i < archivos.length; i++) {
                if (archivos[i].type === 'application/pdf') {
                    dt.items.add(archivos[i]);
                }
            }
            input.files = dt.files;
        } else {
            // Para imagenes: solo el primer archivo
            var dt = new DataTransfer();
            dt.items.add(archivos[0]);
            input.files = dt.files;
        }

        actualizarEstadoZona(zona, input, multiple);
    });

    // Cuando se selecciona archivo con el input nativo
    input.addEventListener('change', function () {
        actualizarEstadoZona(zona, input, multiple);
    });
}

// Actualiza la apariencia de la zona segun los archivos seleccionados
function actualizarEstadoZona(zona, input, multiple) {
    // Limpiar nombre previo
    var prevNombre = zona.querySelector('.nombre_archivo');
    if (prevNombre) prevNombre.remove();

    if (input.files.length > 0) {
        zona.classList.add('tiene_archivo');
        var nombre = document.createElement('p');
        nombre.className = 'nombre_archivo';

        if (multiple) {
            nombre.textContent = input.files.length + ' archivo(s) seleccionado(s)';
            // Actualizar contador de PDFs
            var contador = document.getElementById('pdf_contador');
            if (contador) {
                var nombres = [];
                for (var i = 0; i < input.files.length; i++) {
                    nombres.push(input.files[i].name);
                }
                contador.textContent = nombres.join(', ');
            }
        } else {
            nombre.textContent = input.files[0].name;
        }

        zona.appendChild(nombre);
    } else {
        zona.classList.remove('tiene_archivo');
    }
}

// Resetea una zona de drop a su estado original
function resetearZona(zonaId) {
    var zona = document.getElementById(zonaId);
    if (!zona) return;
    zona.classList.remove('tiene_archivo', 'dragover');
    var nombre = zona.querySelector('.nombre_archivo');
    if (nombre) nombre.remove();
}

// ========================================
// SECCION 11: INICIALIZACION
// ========================================

document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('btn_agregar').addEventListener('click', abrirModal);
    document.getElementById('btn_procesar').addEventListener('click', procesarRecibo);
    document.getElementById('btn_cancelar').addEventListener('click', cerrarModal);

    // Botones de seleccion de tipo de archivo
    document.getElementById('btn_tipo_imagen').addEventListener('click', function () {
        seleccionarModo('imagen');
    });
    document.getElementById('btn_tipo_pdf').addEventListener('click', function () {
        seleccionarModo('pdf');
    });

    document.getElementById('btn_borrar_todos').addEventListener('click', eliminarTodos);

    document.getElementById('btn_cerrar_todos').addEventListener('click', cerrarModalTodos);
    document.getElementById('modal_todos').addEventListener('click', function (e) {
        if (e.target === this) cerrarModalTodos();
    });

    document.getElementById('modal_upload').addEventListener('click', function (e) {
        if (e.target === this) cerrarModal();
    });

    // Configurar zonas de drag & drop
    configurarDropZone('drop_frente', 'imagen_frente', false);
    configurarDropZone('drop_reverso', 'imagen_reverso', false);
    configurarDropZone('drop_pdf', 'archivo_pdf', true);

    // Botones de calculos
    document.getElementById('btn_calc_media').addEventListener('click', calcularMedia);
    document.getElementById('btn_calc_varianza').addEventListener('click', calcularVarianza);

    renderizarRecibos();
});
