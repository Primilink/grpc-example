const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const express = require('express');
const { createEvent, getEventsByDate, getAllEvents } = require('./events');

const PROTO_PATH = path.join(__dirname, '../proto/calendar.proto');
const GRPC_PORT = 50051;
const HTTP_PORT = 3002;

// Load proto file
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const calendarProto = grpc.loadPackageDefinition(packageDefinition).calendar;

// gRPC service implementation
const calendarService = {
  CreateEvent: (call, callback) => {
    const { title, description, date } = call.request;
    console.log(`[gRPC] CreateEvent called: ${title} on ${date}`);

    const event = createEvent(title, description, date);

    callback(null, {
      eventId: event.eventId,
      success: true,
    });
  },

  GetEventsByDate: (call, callback) => {
    const { date } = call.request;
    console.log(`[gRPC] GetEventsByDate called for: ${date}`);

    const events = getEventsByDate(date);

    callback(null, {
      events: events.map((e) => ({
        eventId: e.eventId,
        title: e.title,
        description: e.description,
        date: e.date,
      })),
    });
  },
};

// Start gRPC server
function startGrpcServer() {
  const server = new grpc.Server();
  server.addService(calendarProto.CalendarService.service, calendarService);

  server.bindAsync(
    `0.0.0.0:${GRPC_PORT}`,
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) {
        console.error('Failed to start gRPC server:', err);
        process.exit(1);
      }
      console.log(`gRPC server running on port ${port}`);
    }
  );
}

// Start Express server
function startHttpServer() {
  const app = express();
  app.use(express.json());

  // GET /events - get all events or filter by date
  app.get('/events', (req, res) => {
    const { date } = req.query;

    if (date) {
      const events = getEventsByDate(date);
      return res.json({ events });
    }

    const events = getAllEvents();
    res.json({ events });
  });

  // GET /events/:date - get events for a specific date
  app.get('/events/:date', (req, res) => {
    const { date } = req.params;
    const events = getEventsByDate(date);
    res.json({ events });
  });

  app.listen(HTTP_PORT, () => {
    console.log(`Calendar REST API running on http://localhost:${HTTP_PORT}`);
  });
}

// Start both servers
startGrpcServer();
startHttpServer();
