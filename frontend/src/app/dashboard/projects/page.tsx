/**
 * Projects List Page
 */

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import {
  FolderPlus,
  Trash2,
  Edit,
  MoreVertical,
  FileText,
} from 'lucide-react';

import {
  Card,
  CardContent,
  Button,
  Input,
  TextArea,
  Modal,
  ModalFooter,
  Badge,
} from '@/components/ui';
import { projectsApi } from '@/lib/api';
import { Project } from '@/types';
import { formatRelativeTime } from '@/lib/utils';

const projectSchema = z.object({
  name: z.string().min(1, 'Project name is required').max(100),
  description: z.string().max(500).optional(),
});

type ProjectFormData = z.infer<typeof projectSchema>;

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ProjectFormData>({
    resolver: zodResolver(projectSchema),
  });

  const fetchProjects = async () => {
    try {
      const response = await projectsApi.getAll();
      if (response.success) {
        setProjects(response.data as Project[]);
      }
    } catch (error) {
      toast.error('Failed to load projects');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const onCreateProject = async (data: ProjectFormData) => {
    try {
      const response = await projectsApi.create(data.name, data.description);
      if (response.success) {
        toast.success('Project created successfully');
        setIsCreateModalOpen(false);
        reset();
        fetchProjects();
      }
    } catch (error) {
      toast.error('Failed to create project');
    }
  };

  const onUpdateProject = async (data: ProjectFormData) => {
    if (!editingProject) return;

    try {
      const response = await projectsApi.update(editingProject._id, data);
      if (response.success) {
        toast.success('Project updated successfully');
        setEditingProject(null);
        reset();
        fetchProjects();
      }
    } catch (error) {
      toast.error('Failed to update project');
    }
  };

  const onDeleteProject = async () => {
    if (!deletingProject) return;

    try {
      const response = await projectsApi.delete(deletingProject._id);
      if (response.success) {
        toast.success('Project deleted successfully');
        setDeletingProject(null);
        fetchProjects();
      }
    } catch (error) {
      toast.error('Failed to delete project');
    }
  };

  const openEditModal = (project: Project) => {
    setEditingProject(project);
    reset({ name: project.name, description: project.description || '' });
  };

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-8 w-48 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-40 rounded-xl bg-gray-200 dark:bg-gray-700" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Projects
          </h1>
          <p className="mt-1 text-gray-600 dark:text-gray-400">
            Manage your article generation projects
          </p>
        </div>
        <Button
          leftIcon={<FolderPlus className="h-4 w-4" />}
          onClick={() => {
            reset({ name: '', description: '' });
            setIsCreateModalOpen(true);
          }}
        >
          New Project
        </Button>
      </div>

      {/* Projects Grid */}
      {projects.length === 0 ? (
        <Card className="py-16 text-center">
          <CardContent>
            <FolderPlus className="mx-auto h-16 w-16 text-gray-300 dark:text-gray-600" />
            <h3 className="mt-4 text-lg font-medium text-gray-900 dark:text-white">
              No projects yet
            </h3>
            <p className="mt-2 text-gray-500 dark:text-gray-400">
              Create your first project to start generating SEO articles
            </p>
            <Button
              className="mt-6"
              leftIcon={<FolderPlus className="h-4 w-4" />}
              onClick={() => setIsCreateModalOpen(true)}
            >
              Create First Project
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Card key={project._id} hover>
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <Link href={`/dashboard/project/${project._id}`} className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900 hover:text-blue-600 dark:text-white dark:hover:text-blue-400">
                      {project.name}
                    </h3>
                  </Link>
                  <div className="flex gap-1">
                    <button
                      onClick={() => openEditModal(project)}
                      className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
                    >
                      <Edit className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setDeletingProject(project)}
                      className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {project.description && (
                  <p className="mt-2 line-clamp-2 text-sm text-gray-500 dark:text-gray-400">
                    {project.description}
                  </p>
                )}

                <div className="mt-4 flex items-center justify-between">
                  <Badge variant="default">
                    <FileText className="mr-1 h-3 w-3" />
                    {project.generationsCount || 0} articles
                  </Badge>
                  <span className="text-sm text-gray-400">
                    {formatRelativeTime(project.createdAt)}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Project Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Create New Project"
        description="Projects help you organize your article generations"
      >
        <form onSubmit={handleSubmit(onCreateProject)} className="space-y-4">
          <Input
            label="Project Name"
            placeholder="My SEO Project"
            error={errors.name?.message}
            {...register('name')}
          />
          <TextArea
            label="Description (optional)"
            placeholder="Brief description of this project..."
            rows={3}
            error={errors.description?.message}
            {...register('description')}
          />
          <ModalFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsCreateModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" isLoading={isSubmitting}>
              Create Project
            </Button>
          </ModalFooter>
        </form>
      </Modal>

      {/* Edit Project Modal */}
      <Modal
        isOpen={!!editingProject}
        onClose={() => setEditingProject(null)}
        title="Edit Project"
      >
        <form onSubmit={handleSubmit(onUpdateProject)} className="space-y-4">
          <Input
            label="Project Name"
            placeholder="My SEO Project"
            error={errors.name?.message}
            {...register('name')}
          />
          <TextArea
            label="Description (optional)"
            placeholder="Brief description of this project..."
            rows={3}
            error={errors.description?.message}
            {...register('description')}
          />
          <ModalFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEditingProject(null)}
            >
              Cancel
            </Button>
            <Button type="submit" isLoading={isSubmitting}>
              Save Changes
            </Button>
          </ModalFooter>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={!!deletingProject}
        onClose={() => setDeletingProject(null)}
        title="Delete Project"
        description={`Are you sure you want to delete "${deletingProject?.name}"? This will also delete all generations in this project. This action cannot be undone.`}
      >
        <ModalFooter>
          <Button variant="secondary" onClick={() => setDeletingProject(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onDeleteProject}>
            Delete Project
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
