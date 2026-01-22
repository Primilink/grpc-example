const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const express = require('express');
const { createTodo, getAllTodos, getTodoById, updateTodoFileId } = require('./todos');

const CALENDAR_PROTO_PATH = path.join(__dirname, '../proto/calendar.proto');
const STORAGE_PROTO_PATH = path.join(__dirname, '../proto/storage.proto');
const CALENDAR_GRPC_ADDRESS = 'localhost:50051';
const STORAGE_GRPC_ADDRESS = 'localhost:50052';
const HTTP_PORT = 3001;
const CHUNK_SIZE = 64 * 1024; // 64KB chunks

// Load calendar proto file
const calendarPackageDefinition = protoLoader.loadSync(CALENDAR_PROTO_PATH, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const calendarProto = grpc.loadPackageDefinition(calendarPackageDefinition).calendar;

// Load storage proto file
const storagePackageDefinition = protoLoader.loadSync(STORAGE_PROTO_PATH, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const storageProto = grpc.loadPackageDefinition(storagePackageDefinition).storage;

// Create gRPC clients
const calendarClient = new calendarProto.CalendarService(
  CALENDAR_GRPC_ADDRESS,
  grpc.credentials.createInsecure()
);

const storageClient = new storageProto.StorageService(
  STORAGE_GRPC_ADDRESS,
  grpc.credentials.createInsecure()
);

// Helper to promisify gRPC calls
function createCalendarEvent(title, description, date) {
  return new Promise((resolve, reject) => {
    calendarClient.CreateEvent({ title, description, date }, (err, response) => {
      if (err) {
        reject(err);
      } else {
        resolve(response);
      }
    });
  });
}

// Upload file using client streaming
function uploadFileToStorage(filename, mimeType, buffer) {
  return new Promise((resolve, reject) => {
    const call = storageClient.UploadFile((err, response) => {
      if (err) {
        reject(err);
      } else {
        resolve(response);
      }
    });

    // Send first chunk with metadata
    let offset = 0;
    const firstChunkEnd = Math.min(CHUNK_SIZE, buffer.length);
    call.write({
      data: buffer.slice(0, firstChunkEnd),
      filename,
      mimeType,
    });
    offset = firstChunkEnd;

    // Send remaining chunks
    while (offset < buffer.length) {
      const end = Math.min(offset + CHUNK_SIZE, buffer.length);
      call.write({
        data: buffer.slice(offset, end),
        filename: '',
        mimeType: '',
      });
      offset = end;
    }

    call.end();
  });
}

// Download file using server streaming
function downloadFileFromStorage(fileId) {
  return new Promise((resolve, reject) => {
    const call = storageClient.DownloadFile({ fileId });
    const chunks = [];
    let filename = '';
    let mimeType = '';

    call.on('data', (chunk) => {
      if (!filename && chunk.filename) {
        filename = chunk.filename;
        mimeType = chunk.mimeType || 'application/octet-stream';
      }
      if (chunk.data && chunk.data.length > 0) {
        chunks.push(chunk.data);
      }
    });

    call.on('end', () => {
      resolve({
        filename,
        mimeType,
        buffer: Buffer.concat(chunks),
      });
    });

    call.on('error', (err) => {
      reject(err);
    });
  });
}

// Start Express server
const app = express();
app.use(express.json());

// POST /todos - create a new todo and sync to calendar
app.post('/todos', async (req, res) => {
  const { title, description, date } = req.body;

  if (!title || !date) {
    return res.status(400).json({ error: 'title and date are required' });
  }

  try {
    // Call calendar service via gRPC
    console.log(`[REST] Creating todo: ${title} for ${date}`);
    const calendarResponse = await createCalendarEvent(
      title,
      description || '',
      date
    );
    console.log(`[gRPC] Calendar event created: ${calendarResponse.eventId}`);

    // Create local todo with calendar event reference
    const todo = createTodo(
      title,
      description || '',
      date,
      calendarResponse.eventId
    );

    res.status(201).json({
      todo,
      message: 'Todo created and synced to calendar!',
    });
  } catch (err) {
    console.error('Failed to sync with calendar service:', err.message);

    // Still create the todo locally even if calendar sync fails
    const todo = createTodo(title, description || '', date, null);

    res.status(201).json({
      todo,
      warning: 'Todo created but calendar sync failed',
    });
  }
});

// GET /todos - list all todos
app.get('/todos', (req, res) => {
  const todos = getAllTodos();
  res.json({ todos });
});

// POST /todos/:id/attachment - upload attachment via gRPC streaming
app.post('/todos/:id/attachment', express.raw({ type: '*/*', limit: '10mb' }), async (req, res) => {
  const todoId = req.params.id;
  const todo = getTodoById(todoId);

  if (!todo) {
    return res.status(404).json({ error: 'Todo not found' });
  }

  const filename = req.headers['x-filename'] || `attachment-${Date.now()}.bin`;
  const mimeType = req.headers['content-type'] || 'application/octet-stream';
  const buffer = req.body;

  if (!buffer || buffer.length === 0) {
    return res.status(400).json({ error: 'No file data provided' });
  }

  try {
    console.log(`[REST] Uploading attachment for todo ${todoId}: ${filename} (${buffer.length} bytes)`);

    const uploadResponse = await uploadFileToStorage(filename, mimeType, buffer);
    console.log(`[gRPC] File uploaded: ${uploadResponse.fileId}`);

    // Update todo with file reference
    updateTodoFileId(todoId, uploadResponse.fileId);

    res.status(201).json({
      message: 'Attachment uploaded successfully',
      fileId: uploadResponse.fileId,
      filename: uploadResponse.filename,
      size: uploadResponse.size,
    });
  } catch (err) {
    console.error('Failed to upload to storage service:', err.message);
    res.status(500).json({ error: 'Failed to upload attachment' });
  }
});

// GET /todos/:id/attachment - download attachment via gRPC streaming
app.get('/todos/:id/attachment', async (req, res) => {
  const todoId = req.params.id;
  const todo = getTodoById(todoId);

  if (!todo) {
    return res.status(404).json({ error: 'Todo not found' });
  }

  if (!todo.fileId) {
    return res.status(404).json({ error: 'No attachment for this todo' });
  }

  try {
    console.log(`[REST] Downloading attachment for todo ${todoId}: ${todo.fileId}`);

    const file = await downloadFileFromStorage(todo.fileId);
    console.log(`[gRPC] File downloaded: ${file.filename} (${file.buffer.length} bytes)`);

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Content-Length', file.buffer.length);
    res.send(file.buffer);
  } catch (err) {
    console.error('Failed to download from storage service:', err.message);
    res.status(500).json({ error: 'Failed to download attachment' });
  }
});

app.listen(HTTP_PORT, () => {
  console.log(`Todo REST API running on http://localhost:${HTTP_PORT}`);
  console.log(`Connected to Calendar gRPC service at ${CALENDAR_GRPC_ADDRESS}`);
  console.log(`Connected to Storage gRPC service at ${STORAGE_GRPC_ADDRESS}`);
});
