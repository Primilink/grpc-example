const events = new Map();

let eventIdCounter = 1;

function generateEventId() {
  return `event-${eventIdCounter++}`;
}

function createEvent(title, description, date) {
  const eventId = generateEventId();
  const event = {
    eventId,
    title,
    description,
    date,
  };

  if (!events.has(date)) {
    events.set(date, []);
  }
  events.get(date).push(event);

  return event;
}

function getEventsByDate(date) {
  return events.get(date) || [];
}

function getAllEvents() {
  const allEvents = [];
  for (const dateEvents of events.values()) {
    allEvents.push(...dateEvents);
  }
  return allEvents;
}

module.exports = {
  createEvent,
  getEventsByDate,
  getAllEvents,
};
