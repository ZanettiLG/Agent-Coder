import { useState, useEffect } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  AppBar,
  Toolbar,
  Typography,
  Box,
  CircularProgress,
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import { useGetProjectsQuery, useGetTasksQuery } from '../../app/api/tasksApi';
import { STATUS_ORDER, groupTasksByStatus } from './statusLabels';
import Column from './Column';
import TaskCard from './TaskCard';
import TaskDetailOverlay from './TaskDetailOverlay';
import TaskFormOverlay from './TaskFormOverlay';
import WorkerStatusIndicator from './WorkerStatusIndicator';
import { useBoardState } from './useBoardState';

/**
 * Board Kanban: 5 colunas por status (open, queued, in_progress, done, rejected), cards arrastáveis, overlays para detalhe e formulário.
 * openTaskId: quando vindo de /tasks/:id, abre o detalhe dessa tarefa.
 */
function Board({ openTaskId }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  const {
    detailTaskId,
    formState,
    activeTask,
    handleCardClick,
    handleAddCard,
    handleEditFromDetail,
    handleCloseDetail,
    handleCloseForm,
    handleDragStart,
    handleDragEnd,
  } = useBoardState(openTaskId);

  const { data: projects = [] } = useGetProjectsQuery();
  const [selectedProjectId, setSelectedProjectId] = useState('');
  useEffect(() => {
    if (projects.length > 0 && selectedProjectId === '') {
      setSelectedProjectId(String(projects[0].id));
    }
  }, [projects, selectedProjectId]);

  const projectIdForQuery = selectedProjectId === '' ? undefined : Number(selectedProjectId);
  const { data: tasks, isLoading, error } = useGetTasksQuery(projectIdForQuery);
  const byStatus = groupTasksByStatus(tasks ?? []);

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" p={4}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error">
        Falha ao carregar tarefas: {error?.data?.error ?? error?.message}
      </Alert>
    );
  }

  return (
    <>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" component="span" sx={{ mr: 2 }}>
            Tarefas
          </Typography>
          {projects.length > 0 && (
            <FormControl size="small" sx={{ minWidth: 180 }} color="inherit">
              <InputLabel id="board-project-label">Projeto</InputLabel>
              <Select
                labelId="board-project-label"
                value={selectedProjectId}
                label="Projeto"
                onChange={(e) => setSelectedProjectId(e.target.value)}
              >
                {projects.map((p) => (
                  <MenuItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          <Box sx={{ flexGrow: 1 }} />
          <WorkerStatusIndicator />
        </Toolbar>
      </AppBar>
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <Box
          sx={{
            p: 2,
            display: 'flex',
            gap: 2,
            overflowX: 'auto',
            minHeight: 'calc(100vh - 64px)',
            alignItems: 'flex-start',
          }}
        >
          {STATUS_ORDER.map((status) => (
            <Column
              key={status}
              status={status}
              tasks={byStatus[status] ?? []}
              onAddCard={handleAddCard}
              onCardClick={handleCardClick}
            />
          ))}
        </Box>
        <DragOverlay dropAnimation={null}>
          {activeTask ? (
            <Box
              sx={{
                cursor: 'grabbing',
                boxShadow: 3,
                transform: 'rotate(2deg)',
                maxWidth: 280,
              }}
            >
              <TaskCard task={activeTask} />
            </Box>
          ) : null}
        </DragOverlay>
      </DndContext>

      <TaskDetailOverlay
        taskId={detailTaskId}
        open={Boolean(detailTaskId)}
        onClose={handleCloseDetail}
        onEdit={handleEditFromDetail}
      />

      <TaskFormOverlay
        open={formState.open}
        taskId={formState.taskId}
        initialStatus={formState.status}
        initialProjectId={selectedProjectId ? Number(selectedProjectId) : undefined}
        onClose={handleCloseForm}
        onSuccess={() => {}}
      />
    </>
  );
}

export default Board;
