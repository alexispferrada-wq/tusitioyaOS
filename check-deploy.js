#!/usr/bin/env node
/**
 * Script de verificación pre-deploy
 * Ejecutar antes de hacer deploy a Render
 * 
 * Uso: node check-deploy.js
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 VERIFICACIÓN PRE-DEPLOY - TuSitioYa OS\n');
console.log('=' .repeat(60));

let errores = 0;
let advertencias = 0;

// 1. Verificar archivos críticos
console.log('\n📁 1. Verificando archivos críticos...\n');

const archivosCriticos = [
    'server.js',
    'package.json',
    'index.html',
    'dashboard.html',
    'previo_comando.html',
    '.gitignore',
    'setup_db.js'
];

archivosCriticos.forEach(archivo => {
    if (fs.existsSync(path.join(__dirname, archivo))) {
        console.log(`  ✅ ${archivo}`);
    } else {
        console.log(`  ❌ ${archivo} - FALTA`);
        errores++;
    }
});

// 2. Verificar package.json
console.log('\n📦 2. Verificando package.json...\n');

try {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    
    if (packageJson.scripts && packageJson.scripts.start) {
        console.log('  ✅ Script "start" definido');
    } else {
        console.log('  ❌ Script "start" no definido');
        errores++;
    }
    
    if (packageJson.engines && packageJson.engines.node) {
        console.log(`  ✅ Node version: ${packageJson.engines.node}`);
    } else {
        console.log('  ⚠️  Node version no especificada en engines');
        advertencias++;
    }
} catch (e) {
    console.log('  ❌ Error leyendo package.json');
    errores++;
}

// 3. Verificar server.js - Puerto
console.log('\n🖥️  3. Verificando configuración de servidor...\n');

const serverContent = fs.readFileSync('server.js', 'utf8');

if (serverContent.includes('process.env.PORT')) {
    console.log('  ✅ Puerto usa process.env.PORT (correcto para Render)');
} else if (serverContent.includes('app.listen(3000') || serverContent.includes('app.listen (3000')) {
    console.log('  ❌ Puerto hardcodeado a 3000 - DEBE CORREGIRSE');
    errores++;
} else {
    console.log('  ⚠️  No se pudo verificar configuración de puerto');
    advertencias++;
}

if (serverContent.includes('express.static(__dirname)')) {
    console.log('  ✅ Static files configurados');
} else {
    console.log('  ❌ Static files no configurados');
    errores++;
}

if (serverContent.includes('cors()')) {
    console.log('  ✅ CORS habilitado');
} else {
    console.log('  ⚠️  CORS no detectado');
    advertencias++;
}

// 4. Verificar .gitignore
console.log('\n🔒 4. Verificando .gitignore...\n');

const gitignore = fs.readFileSync('.gitignore', 'utf8');
const elementosRequeridos = ['node_modules/', '.env', '.DS_Store', '*.log'];

elementosRequeridos.forEach(elem => {
    if (gitignore.includes(elem)) {
        console.log(`  ✅ ${elem} excluido`);
    } else {
        console.log(`  ⚠️  ${elem} no está en .gitignore`);
        advertencias++;
    }
});

// 5. Verificar que .env NO esté en git
console.log('\n🚫 5. Verificando que .env no esté en git...\n');

try {
    const { execSync } = require('child_process');
    const trackedFiles = execSync('git ls-files', { encoding: 'utf8' });
    
    if (trackedFiles.includes('.env')) {
        console.log('  ❌ .env está trackeado en git - REMOVER INMEDIATAMENTE');
        errores++;
    } else {
        console.log('  ✅ .env no está en git');
    }
} catch (e) {
    console.log('  ⚠️  No se pudo verificar git (quizás no es repo)');
}

// 6. Verificar variables de entorno locales
console.log('\n🔐 6. Verificando variables de entorno locales...\n');

require('dotenv').config();

const varsRequeridas = ['DATABASE_URL', 'GEMINI_API_KEY'];
const varsOpcionales = ['GROQ_API_KEY', 'KIMI_API_KEY'];

varsRequeridas.forEach(v => {
    if (process.env[v]) {
        console.log(`  ✅ ${v} configurada`);
    } else {
        console.log(`  ❌ ${v} NO configurada (REQUERIDA)`);
        errores++;
    }
});

varsOpcionales.forEach(v => {
    if (process.env[v]) {
        console.log(`  ✅ ${v} configurada`);
    } else {
        console.log(`  ⚠️  ${v} no configurada (opcional)`);
    }
});

// 7. Verificar tamaño de archivos HTML
console.log('\n📊 7. Verificando tamaño de archivos HTML...\n');

const archivosHTML = ['index.html', 'dashboard.html', 'previo_comando.html'];

archivosHTML.forEach(archivo => {
    if (fs.existsSync(archivo)) {
        const stats = fs.statSync(archivo);
        const sizeKB = (stats.size / 1024).toFixed(2);
        
        if (stats.size > 5 * 1024 * 1024) { // 5MB
            console.log(`  ⚠️  ${archivo}: ${sizeKB} KB (muy grande, considerar optimización)`);
            advertencias++;
        } else {
            console.log(`  ✅ ${archivo}: ${sizeKB} KB`);
        }
    }
});

// Resumen final
console.log('\n' + '='.repeat(60));
console.log('📋 RESUMEN:\n');

if (errores === 0 && advertencias === 0) {
    console.log('🎉 ¡TODO LISTO PARA DEPLOY!');
    console.log('   Ejecuta: git push origin main');
    process.exit(0);
} else {
    console.log(`❌ Errores: ${errores}`);
    console.log(`⚠️  Advertencias: ${advertencias}\n`);
    
    if (errores > 0) {
        console.log('🔴 NO HAGAS DEPLOY hasta corregir los errores.');
        process.exit(1);
    } else {
        console.log('🟡 Puedes hacer deploy pero revisa las advertencias.');
        process.exit(0);
    }
}
