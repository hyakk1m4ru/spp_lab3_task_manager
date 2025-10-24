let tasks = [];
let idCounter = 1;

function addTask(data, file) {
    const task = {
        id: idCounter++,
        title: data.title,
        status: data.status || 'pending',
        dueDate: data.dueDate || null,
        file: file ? file.filename : null
    };
    tasks.push(task);
    return task;
}

function updateTask(id, data, file) {
    const task = tasks.find(t => t.id == id);
    if (!task) return null;
    task.title = data.title ?? task.title;
    task.status = data.status ?? task.status;
    task.dueDate = data.dueDate ?? task.dueDate;
    if (file) task.file = file.filename;
    return task;
}

function deleteTask(id) {
    const index = tasks.findIndex(t => t.id == id);
    if (index === -1) return false;
    tasks.splice(index, 1);
    return true;
}

module.exports = { tasks, addTask, updateTask, deleteTask };
