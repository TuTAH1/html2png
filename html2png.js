const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const marked = require('marked');
const sharp = require('sharp');
const os = require('os');

(async () => {
  // Парсинг аргументов командной строки
  const args = process.argv.slice(2);
  let inputPath = null;
  let tempOutputPath = null;
  let outputPath = null;
  let customOutputPath = null;
  let scale = 1.0;
  
  // Обработка аргументов
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--scale' || args[i] === '-s') {
      if (i + 1 < args.length) {
        scale = parseFloat(args[i + 1]);
        if (isNaN(scale) || scale <= 0) {
          console.error('❌ Масштаб должен быть положительным числом.');
          process.exit(1);
        }
        i++; // Пропускаем следующий аргумент, так как он уже обработан
      }
    } else if (args[i] === '--output' || args[i] === '-o') {
      if (i + 1 < args.length) {
        customOutputPath = args[i + 1];
        i++; // Пропускаем следующий аргумент
      }
    } else if (!inputPath) {
      inputPath = args[i];
    }
  }

  if (!inputPath || !fs.existsSync(inputPath)) {
    console.error('❌ Укажи путь к существующему HTML или Markdown файлу.');
    console.error('Использование: node html2png.js <путь_к_файлу> [--scale|-s <масштаб>] [--output|-o <путь_вывода>]');
    process.exit(1);
  }

  // Get the absolute file path and directory
  const absoluteFilePath = path.resolve(inputPath);
  const fileExt = path.extname(inputPath).toLowerCase();
  const inputDir = path.dirname(absoluteFilePath);
  const fileName = path.basename(absoluteFilePath, fileExt);
  
  // Если путь вывода не указан, используем тот же путь, что и у входного файла
  if (!customOutputPath) {
    customOutputPath = path.join(inputDir);
  }
  outputPath = path.join(customOutputPath, `${fileName}.png`);
  tempOutputPath = outputPath.replace('.png', '.uncropped.png');
  
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  let tempHtmlPath = null;

  try {
    // Обработка в зависимости от типа файла
    if (fileExt === '.md') {
      // Для Markdown файлов
      const mdContent = fs.readFileSync(inputPath, 'utf8');
      
      // Настраиваем marked для поддержки HTML внутри Markdown
      marked.setOptions({
        headerIds: true,
        mangle: false,
        gfm: true,
        breaks: true,
        pedantic: false,
        sanitize: false, // Важно! Не экранировать HTML
        smartLists: true,
        smartypants: true,
        xhtml: false
      });
      
      const htmlContent = marked.parse(mdContent);
      
      // Добавляем базовые стили для Markdown
      const styledHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <base href="file://${inputDir.replace(/\\/g, '/')}/"> <!-- Устанавливаем базовый URL для относительных путей -->
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 800px;
              margin: 0 auto;
              padding: 20px;
            }
            pre {
              background-color: #f6f8fa;
              border-radius: 3px;
              padding: 16px;
              overflow: auto;
            }
            code {
              font-family: SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;
              background-color: rgba(27, 31, 35, 0.05);
              border-radius: 3px;
              padding: 0.2em 0.4em;
              font-size: 85%;
            }
            pre code {
              background-color: transparent;
              padding: 0;
            }
            blockquote {
              border-left: 4px solid #ddd;
              padding-left: 16px;
              color: #666;
              margin-left: 0;
            }
            img {
              max-width: 100%;
            }
            table {
              border-collapse: collapse;
              width: 100%;
            }
            table, th, td {
              border: 1px solid #ddd;
            }
            th, td {
              padding: 8px;
              text-align: left;
            }
            th {
              background-color: #f6f8fa;
            }
          </style>
        </head>
        <body>
          ${htmlContent}
        </body>
        </html>
      `;
      
      // Создаем временный HTML-файл в том же каталоге, что и исходный MD-файл
      // Это важно для корректной загрузки относительных путей
      tempHtmlPath = path.join(inputDir, `_temp_${Date.now()}.html`);
      fs.writeFileSync(tempHtmlPath, styledHtml, 'utf8');
      
      // Загружаем временный HTML-файл
      await page.goto(`file://${tempHtmlPath}`, { waitUntil: 'networkidle0' });
    } else {
      // Для HTML файлов - загружаем напрямую
      await page.goto(`file://${absoluteFilePath}`, { waitUntil: 'networkidle0' });
    }
    
    // Получаем размеры всего контента
    const dimensions = await page.evaluate(() => {
      return {
        width: Math.max(
          document.body.scrollWidth,
          document.documentElement.scrollWidth,
          document.body.offsetWidth,
          document.documentElement.offsetWidth,
          document.body.clientWidth,
          document.documentElement.clientWidth
        ),
        height: Math.max(
          document.body.scrollHeight,
          document.documentElement.scrollHeight,
          document.body.offsetHeight,
          document.documentElement.offsetHeight,
          document.body.clientHeight,
          document.documentElement.clientHeight
        )
      };
    });

    // Устанавливаем viewport с учетом масштаба
    await page.setViewport({
      width: Math.ceil(dimensions.width),
      height: Math.ceil(dimensions.height),
      deviceScaleFactor: scale // Устанавливаем масштаб
    });

    // Делаем скриншот
    await page.screenshot({
      path: tempOutputPath,
      omitBackground: true
    });

     await browser.close();

  // Используем Sharp для обрезки прозрачных областей
  try {
    await sharp(tempOutputPath)
      .trim() // Обрезает прозрачные края
      .toFile(outputPath);
    
    // Удаляем временный файл
    fs.unlinkSync(tempOutputPath);
    
        console.log(`✅ Сохранено: ${outputPath} (масштаб: ${scale}x)`);

  } catch (error) {
    console.error('❌ Ошибка при обрезке изображения:', error);
    // Если не удалось обрезать, оставляем исходный файл
    fs.renameSync(tempOutputPath, outputPath);
    console.log(`✅ Сохранено без обрезки: ${outputPath} (масштаб: ${scale}x)`);
  }

  } catch (error) {
    console.error('❌ Ошибка при создании скриншота:', error);
  } finally {
    // Закрываем браузер
    await browser.close();
    
    // Удаляем временный HTML-файл, если он был создан
    if (tempHtmlPath && fs.existsSync(tempHtmlPath)) {
      fs.unlinkSync(tempHtmlPath);
    }
  }
})();
