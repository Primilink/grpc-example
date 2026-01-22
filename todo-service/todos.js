const todos = [];

let todoIdCounter = 1;

function generateTodoId() {
  return `todo-${todoIdCounter++}`;
}

function createTodo(title, description, date, calendarEventId = null) {
  const todo = {
    id: generateTodoId(),
    title,
    description,
    date,
    calendarEventId,
    fileId: null,
    completed: false,
    createdAt: new Date().toISOString(),
  };

  todos.push(todo);
  return todo;
}

function updateTodoFileId(todoId, fileId) {
  const todo = todos.find((t) => t.id === todoId);
  if (todo) {
    todo.fileId = fileId;
    return todo;
  }
  return null;
}

function getAllTodos() {
  return todos;
}

function getTodoById(id) {
  return todos.find((t) => t.id === id);
}

module.exports = {
  createTodo,
  getAllTodos,
  getTodoById,
  updateTodoFileId,
};
