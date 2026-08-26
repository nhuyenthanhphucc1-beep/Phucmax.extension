#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Đọc JSON bundle
const bundleFile = path.join(__dirname, 'extension-bundle.json');
if (!fs.existsSync(bundleFile)) {
  console.error('❌ Không tìm thấy extension-bundle.json');
  process.exit(1);
}

const bundle = JSON.parse(fs.readFileSync(bundleFile, 'utf8'));

// Tạo thư mục extension
const outputDir = path.join(process.cwd(), `phucmax-extension-${bundle.version}`);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

console.log(`📦 Đang extract extension từ JSON...`);
console.log(`📁 Thư mục đích: ${outputDir}\n`);

// Extract từng file
for (const [filename, content] of Object.entries(bundle.files)) {
  const filePath = path.join(outputDir, filename);
  
  // Tạo thư mục nếu cần
  const fileDir = path.dirname(filePath);
  if (!fs.existsSync(fileDir)) {
    fs.mkdirSync(fileDir, { recursive: true });
  }
  
  // Ghi file
  fs.writeFileSync(filePath, content);
  console.log(`✅ ${filename}`);
}

console.log(`\n✨ Hoàn tất! Thư mục extension: ${outputDir}\n`);
console.log('📋 Hướng dẫn cài đặt:');
console.log('1. Mở Chrome → chrome://extensions/');
console.log('2. Bật "Developer mode" (góc trên phải)');
console.log('3. Click "Load unpacked"');
console.log(`4. Chọn thư mục: ${outputDir}`);
console.log('\n✨ Done!');
