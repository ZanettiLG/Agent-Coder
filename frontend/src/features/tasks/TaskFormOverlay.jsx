import { useState } from 'react';
import {
  Box,
  TextField,
  MenuItem,
  Button,
  FormControl,
  InputLabel,
  Select,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Chip,
  Menu,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import { useSnackbar } from '../../app/SnackbarContext';
import { useGetProjectsQuery } from '../../app/api/tasksApi';
import { getStatusLabel, STATUS_OPTIONS } from './statusLabels';
import { useTaskForm } from './useTaskForm';
import RepoFilePickerDialog from './RepoFilePickerDialog';

/**
 * Formulário de criar/editar tarefa em overlay (modal). Usado no board Kanban.
 * taskId = null para criar; initialStatus = status da coluna ao clicar "Adicionar card".
 * initialProjectId = projeto selecionado no board ao criar.
 */
function TaskFormOverlay({
  open,
  taskId,
  initialStatus = 'open',
  initialProjectId,
  onClose,
  onSuccess,
}) {
  const { showSnackbar } = useSnackbar();
  const {
    title,
    setTitle,
    status,
    setStatus,
    body,
    setBody,
    context,
    setContext,
    projectId,
    setProjectId,
    handleSubmit,
    isSubmitting,
    isLoadingTask,
    isEdit,
  } = useTaskForm({ taskId, initialStatus, initialProjectId, open });

  const { data: projects = [] } = useGetProjectsQuery(undefined, { skip: !open });
  const [contextMenuAnchor, setContextMenuAnchor] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState('file');

  const handleAddContext = (ref) => {
    setContext([...(context || []), ref]);
  };

  const handleRemoveContext = (index) => {
    setContext(context.filter((_, i) => i !== index));
  };

  const openPicker = (mode) => {
    setPickerMode(mode);
    setContextMenuAnchor(null);
    setPickerOpen(true);
  };

  const contextLabel = (ref) => {
    if (ref.type === 'file') return `@file ${ref.path}`;
    if (ref.type === 'folder') return `@folder ${ref.path}`;
    if (ref.type === 'codebase') return '@codebase';
    if (ref.type === 'git') return `@git ${ref.scope || 'working'}`;
    if (ref.type === 'skill' || ref.type === 'rule') return '@skill/regras';
    if (ref.type === 'docs') return ref.url ? `@docs ${ref.url}` : `@docs ${ref.path || ''}`;
    return ref.type;
  };

  const onFormSubmit = async (e) => {
    try {
      await handleSubmit(e);
      showSnackbar({ message: isEdit ? 'Tarefa atualizada' : 'Tarefa criada', severity: 'success' });
      onSuccess?.();
      onClose?.();
    } catch (err) {
      showSnackbar({
        message: err?.data?.error ?? 'Falha ao salvar',
        severity: 'error',
      });
    }
  };

  const bodyContent = () => {
    if (isEdit && isLoadingTask) {
      return (
        <Box display="flex" justifyContent="center" p={4}>
          <CircularProgress />
        </Box>
      );
    }
    return (
      <form onSubmit={onFormSubmit} id="task-form-overlay">
        <TextField
          fullWidth
          label="Título"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          margin="normal"
          placeholder="Título da tarefa"
        />
        {projects.length > 0 && (
          <FormControl fullWidth margin="normal">
            <InputLabel id="task-form-project-label">Projeto</InputLabel>
            <Select
              labelId="task-form-project-label"
              label="Projeto"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              {projects.map((p) => (
                <MenuItem key={p.id} value={String(p.id)}>
                  {p.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
        <FormControl fullWidth margin="normal">
          <InputLabel id="task-form-status-label">Status</InputLabel>
          <Select
            labelId="task-form-status-label"
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {STATUS_OPTIONS.map((opt) => (
              <MenuItem key={opt.value} value={opt.value}>
                {opt.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Box sx={{ mt: 2, mb: 1 }}>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Contexto (como no Cursor)
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
            {Array.isArray(context) && context.map((ref, i) => (
              <Chip
                key={i}
                label={contextLabel(ref)}
                size="small"
                onDelete={() => handleRemoveContext(i)}
                sx={{ mb: 0.5 }}
              />
            ))}
            <Button
              size="small"
              startIcon={<AddIcon />}
              onClick={(e) => setContextMenuAnchor(e.currentTarget)}
              aria-haspopup="true"
              aria-controls={contextMenuAnchor ? 'context-menu' : undefined}
            >
              Adicionar @
            </Button>
          </Box>
        </Box>
        <Menu
          id="context-menu"
          anchorEl={contextMenuAnchor}
          open={Boolean(contextMenuAnchor)}
          onClose={() => setContextMenuAnchor(null)}
          MenuListProps={{ 'aria-labelledby': 'context-menu' }}
        >
          <MenuItem onClick={() => openPicker('file')}>Arquivo</MenuItem>
          <MenuItem onClick={() => openPicker('folder')}>Pasta</MenuItem>
          <MenuItem onClick={() => { handleAddContext({ type: 'codebase' }); setContextMenuAnchor(null); }}>
            Codebase
          </MenuItem>
          <MenuItem onClick={() => { handleAddContext({ type: 'git', scope: 'working' }); setContextMenuAnchor(null); }}>
            Git (diff)
          </MenuItem>
          <MenuItem onClick={() => { handleAddContext({ type: 'skill' }); setContextMenuAnchor(null); }}>
            Skill / Regras
          </MenuItem>
        </Menu>
        <RepoFilePickerDialog
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          mode={pickerMode}
          onSelect={handleAddContext}
        />
        <TextField
          fullWidth
          label="Conteúdo (Markdown)"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          multiline
          rows={10}
          margin="normal"
          placeholder="Conteúdo da tarefa em Markdown..."
        />
      </form>
    );
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { maxHeight: '90vh' } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pr: 1 }}>
        {isEdit ? 'Editar tarefa' : `Nova tarefa · ${getStatusLabel(initialStatus)}`}
        <IconButton aria-label="Fechar" onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {bodyContent()}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="task-form-overlay" variant="contained" disabled={isSubmitting}>
          {isSubmitting ? 'Salvando…' : 'Salvar'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default TaskFormOverlay;
