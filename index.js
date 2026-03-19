// index.js
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const multer = require("multer");
const fs = require("fs");

// --- Inicialización ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- Configuración de Express ---
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public"))); // Servir archivos estáticos (CSS, JS, imágenes)
app.use("/uploads", express.static(path.join(__dirname, "public/uploads"))); // Hacer accesibles las imágenes subidas

// --- Almacenamiento en memoria (para simplicidad) ---
let currentImage = "/placeholder.png"; // Imagen por defecto
let textPages = [
  "Bienvenido al prompter. Actualiza el texto desde el panel de administración.",
];
let currentPageIndex = 0;

// --- Configuración de Multer para la subida de archivos ---
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "public/uploads/"); // Directorio donde se guardarán las imágenes
  },
  filename: function (req, file, cb) {
    // Asegura un nombre de archivo único añadiendo la fecha
    cb(null, Date.now() + path.extname(file.originalname));
  },
});
const upload = multer({ storage: storage });

// --- Rutas de la Aplicación ---

// Redirección a la página de administración
app.get("/", (req, res) => {
  res.redirect("/admin");
});

// Página de Administración
app.get("/admin", (req, res) => {
  const uploadsDir = path.join(__dirname, "public/uploads");
  // Asegurarse de que el directorio existe para evitar errores
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  fs.readdir(uploadsDir, (err, files) => {
    const images = files
      ? files.filter((file) => /\.(png|jpg|jpeg|gif|webp)$/i.test(file))
      : [];
    res.render("admin", {
      pages: textPages,
      currentPage: currentPageIndex,
      images,
      currentImage,
    });
  });
});

// Página para mostrar la imagen
app.get("/image", (req, res) => {
  res.render("image");
});

// Página para mostrar el texto (prompter)
app.get("/prompter", (req, res) => {
  res.render("prompter");
});

// Endpoint para subir la imagen
app.post("/upload-image", upload.single("image"), (req, res) => {
  if (req.file) {
    console.log(`Imagen subida: ${req.file.filename}`);
    const images = getImages();
    io.emit("image-list-update", images);
  }
  res.redirect("/admin");
});

// Función auxiliar para leer imágenes
function getImages() {
  const uploadsDir = path.join(__dirname, "public/uploads");
  if (!fs.existsSync(uploadsDir)) return [];
  return fs
    .readdirSync(uploadsDir)
    .filter((file) => /\.(png|jpg|jpeg|gif|webp)$/i.test(file));
}

// --- Lógica de Socket.IO ---
io.on("connection", (socket) => {
  console.log("Un cliente se ha conectado");

  // Enviar estado actual al nuevo cliente
  socket.emit("image-update", currentImage);
  socket.emit("text-update", textPages[currentPageIndex]); // Para clientes prompter
  socket.emit("pagination-update", {
    pages: textPages,
    currentPage: currentPageIndex,
  }); // Para clientes admin

  // Escuchar selección de imagen desde el admin (Carrusel)
  socket.on("select-image", (filename) => {
    currentImage = `/uploads/${filename}`;
    io.emit("image-update", currentImage);
    console.log(`Imagen seleccionada: ${currentImage}`);
  });

  // Escuchar evento de borrar imagen
  socket.on("delete-image", (filename) => {
    const filePath = path.join(__dirname, "public/uploads", filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`Imagen eliminada: ${filename}`);
      const images = getImages();
      io.emit("image-list-update", images);
      // Si la imagen borrada era la actual, podríamos resetearla,
      // pero por ahora mantenemos el estado visual hasta que el usuario elija otra.
    }
  });

  // Escuchar actualización de texto de una página específica
  socket.on("update-page-text", ({ pageIndex, text }) => {
    if (pageIndex >= 0 && pageIndex < textPages.length) {
      textPages[pageIndex] = text;
      console.log(`Texto de la página ${pageIndex + 1} actualizado.`);
      // Si la página actualizada es la activa, notificar a los prompters
      if (pageIndex === currentPageIndex) {
        io.emit("text-update", textPages[currentPageIndex]);
      }
      // Notificar a los admins para que tengan el contenido más reciente (para sincronizar otros admins)
      io.emit("pagination-update", {
        pages: textPages,
        currentPage: currentPageIndex,
      });
    }
  });

  // Escuchar para crear una nueva pestaña/página
  socket.on("create-tab", () => {
    textPages.push("Nueva página.");
    console.log(`Pestaña creada. Ahora hay ${textPages.length} páginas.`);
    // Notificar a todos
    io.emit("text-update", textPages[currentPageIndex]);
    io.emit("pagination-update", {
      pages: textPages,
      currentPage: currentPageIndex,
    });
  });

  // Escuchar para eliminar una pestaña/página
  socket.on("delete-tab", (pageIndex) => {
    // No permitir borrar la última página
    if (textPages.length <= 1) {
      console.log("No se puede eliminar la última página.");
      return;
    }
    if (pageIndex >= 0 && pageIndex < textPages.length) {
      textPages.splice(pageIndex, 1);
      console.log(`Página ${pageIndex + 1} eliminada.`);

      // Ajustar el índice de la página actual para que no quede fuera de rango
      if (currentPageIndex >= pageIndex) {
        currentPageIndex = Math.max(0, currentPageIndex - 1);
      }

      // Notificar a todos
      io.emit("text-update", textPages[currentPageIndex]);
      io.emit("pagination-update", {
        pages: textPages,
        currentPage: currentPageIndex,
      });
    }
  });

  // Escuchar cambios de página desde el admin
  socket.on("change-page", (pageIndex) => {
    if (pageIndex >= 0 && pageIndex < textPages.length) {
      currentPageIndex = pageIndex;
      io.emit("text-update", textPages[currentPageIndex]); // Notificar al prompter
      io.emit("pagination-update", {
        pages: textPages,
        currentPage: currentPageIndex,
      }); // Notificar a los admins
      console.log(`Cambiado a la página: ${currentPageIndex + 1}`);
    }
  });

  socket.on("disconnect", () => {
    console.log("Un cliente se ha desconectado");
  });
});

// --- Iniciar Servidor ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
  console.log(`Panel de Administración: http://localhost:${PORT}/admin`);
  console.log(`Visor de Imagen: http://localhost:${PORT}/image`);
  console.log(`Visor de Prompter: http://localhost:${PORT}/prompter`);
});
