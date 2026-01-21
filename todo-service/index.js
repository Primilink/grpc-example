const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const express = require('express');
const { createTodo, getAllTodos } = require('./todos');

const PROTO_PATH = path.join(__dirname, '../proto/calendar.proto');
const CALENDAR_GRPC_ADDRESS = 'localhost:50051';
const HTTP_PORT = 3001;

// Load proto file
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const calendarProto = grpc.loadPackageDefinition(packageDefinition).calendar;

// Create gRPC client
const calendarClient = new calendarProto.CalendarService(
  CALENDAR_GRPC_ADDRESS,
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

app.listen(HTTP_PORT, () => {
  console.log(`Todo REST API running on http://localhost:${HTTP_PORT}`);
  console.log(`Connected to Calendar gRPC service at ${CALENDAR_GRPC_ADDRESS}`);
});
