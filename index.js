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
let prompts = [
  {
    title: "Inicio",
    text: "En nuestro canal, 30 Minutitos de Fama y Fútbol, nos dedicamos principalmente a crear recopilaciones de los momentos más destacados, curiosos y extremos del fútbol profesional. Nos enfocamos en entretener a nuestra audiencia mediante videos que agrupan jugadas específicas bajo temáticas llamativas.",
  },
];
let currentPromptIndex = 0;
let liveText = prompts[0].text; // Variable para controlar el texto que ve el público
let liveTitle = prompts[0].title;

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
      prompts,
      currentPromptIndex,
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
  socket.emit("text-update", liveText); // Enviar el texto 'en vivo', no el que se está editando
  socket.emit("title-update", liveTitle);
  socket.emit("prompt-list-update", {
    prompts,
    currentPromptIndex,
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

  // Escuchar actualización de un prompt (título y texto)
  socket.on("update-prompt", ({ index, title, text }) => {
    if (index >= 0 && index < prompts.length) {
      prompts[index] = { title, text };
      console.log(`Prompt ${index + 1} actualizado.`);
      // Notificar a los admins para que tengan el contenido más reciente (para sincronizar otros admins)
      io.emit("prompt-list-update", {
        prompts,
        currentPromptIndex,
      });
    }
  });

  // Escuchar para crear un nuevo prompt
  socket.on("create-prompt", () => {
    prompts.push({ title: "Nuevo Prompt", text: "Escribe aquí..." });
    console.log(`Prompt creado. Ahora hay ${prompts.length} prompts.`);
    // Notificar a todos
    io.emit("prompt-list-update", {
      prompts,
      currentPromptIndex,
    });
  });

  // Escuchar para eliminar un prompt
  socket.on("delete-prompt", (index) => {
    // No permitir borrar el último prompt
    if (prompts.length <= 1) {
      console.log("No se puede eliminar el último prompt.");
      return;
    }
    if (index >= 0 && index < prompts.length) {
      prompts.splice(index, 1);
      console.log(`Prompt ${index + 1} eliminado.`);

      // Ajustar el índice del prompt actual para que no quede fuera de rango
      if (currentPromptIndex >= index) {
        currentPromptIndex = Math.max(0, currentPromptIndex - 1);
      }

      // Notificar a todos
      io.emit("prompt-list-update", {
        prompts,
        currentPromptIndex,
      });
    }
  });

  // Escuchar selección de prompt desde el admin
  socket.on("select-prompt", (index) => {
    if (index >= 0 && index < prompts.length) {
      currentPromptIndex = index;
      io.emit("prompt-list-update", {
        prompts,
        currentPromptIndex,
      }); // Notificar a los admins
      console.log(`Prompt seleccionado: ${currentPromptIndex + 1}`);
    }
  });

  // Nuevo evento para enviar explícitamente el texto al prompter
  socket.on("send-prompt", () => {
    if (currentPromptIndex >= 0 && currentPromptIndex < prompts.length) {
      liveText = prompts[currentPromptIndex].text;
      liveTitle = prompts[currentPromptIndex].title;
      io.emit("text-update", liveText);
      io.emit("title-update", liveTitle);
      console.log(
        `Texto enviado al prompter (Prompt ${currentPromptIndex + 1})`,
      );
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
