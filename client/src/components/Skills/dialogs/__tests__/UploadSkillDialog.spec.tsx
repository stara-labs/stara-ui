import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { FileConfigInput } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import UploadSkillDialog, { isSkillFileOverSizeLimit } from '../UploadSkillDialog';

const mockMutate = jest.fn();
const mockNavigate = jest.fn();
const mockSetIsOpen = jest.fn();
const mockShowToast = jest.fn();
let mockFileConfigInput: FileConfigInput | undefined = {
  skills: {
    fileSizeLimit: 1,
  },
};

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

jest.mock(
  '@librechat/client',
  () => {
    const React = jest.requireActual<typeof import('react')>('react');
    return {
      OGDialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
        open ? React.createElement('div', null, children) : null,
      OGDialogContent: ({ children }: { children: ReactNode }) =>
        React.createElement('div', null, children),
      Spinner: () => React.createElement('div', { 'data-testid': 'spinner' }),
      useToastContext: () => ({
        showToast: mockShowToast,
      }),
    };
  },
  { virtual: true },
);

jest.mock('librechat-data-provider', () => {
  const megabyte = 1024 * 1024;
  return {
    megabyte,
    fileConfig: {
      skills: {
        fileSizeLimit: megabyte,
      },
    },
    mergeFileConfig: (data?: FileConfigInput) => ({
      skills: {
        fileSizeLimit: (data?.skills?.fileSizeLimit ?? 1) * megabyte,
      },
    }),
  };
});

jest.mock('~/data-provider', () => ({
  useGetFileConfig: ({ select }: { select?: (data: FileConfigInput | undefined) => unknown }) => ({
    data: select != null ? select(mockFileConfigInput) : mockFileConfigInput,
  }),
  useImportSkillMutation: () => ({
    mutate: mockMutate,
    isLoading: false,
  }),
}));

jest.mock('~/hooks', () => ({
  useLocalize:
    () =>
    (key: string, params?: Record<string, string | number | undefined>): string => {
      const translations: Record<string, string> = {
        com_ui_skill_upload_title: 'Upload skill',
        com_ui_skill_upload_drag: 'Drag and drop or click to upload',
        com_ui_skill_upload_requirements: 'File requirements',
        com_ui_skill_upload_req_md:
          '.md file must contain skill name and description formatted in YAML',
        com_ui_skill_upload_req_zip: '.zip or .skill file must include a SKILL.md file',
        com_ui_skill_upload_req_size: `File size must not exceed ${params?.[0]} MB`,
        com_ui_skill_upload_size_error: `Skill import must not exceed ${params?.[0]} MB`,
        com_ui_skill_created: 'Skill created',
        com_ui_create_skill_upload_error: 'Failed to read the uploaded file',
      };
      return translations[key] ?? key;
    },
}));

jest.mock('~/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
}));

function getUploadDropTarget(): HTMLElement {
  // Use the visible drop target instead of the hidden file input. Full-suite runs can
  // contain hidden file inputs from other surfaces, but the drop target owns this flow.
  const targets = screen.getAllByRole('button', {
    name: 'Drag and drop or click to upload',
  });
  const target = targets.at(-1);
  if (!(target instanceof HTMLElement)) {
    throw new Error('Upload drop target was not rendered');
  }
  return target;
}

function dropSkillFile(file: File): void {
  fireEvent.drop(getUploadDropTarget(), {
    dataTransfer: {
      files: [file],
    },
  });
}

function getSubmittedFormData(): FormData {
  const submitted = mockMutate.mock.calls[0]?.[0];
  if (!(submitted instanceof FormData)) {
    throw new Error('Skill upload did not submit FormData');
  }
  return submitted;
}

function expectSubmittedFile(file: File): void {
  const submitted = getSubmittedFormData();
  const submittedFile = submitted.get('file');
  if (!(submittedFile instanceof File)) {
    throw new Error('Skill upload FormData did not include a file');
  }
  expect(submittedFile.name).toBe(file.name);
  expect(submittedFile.size).toBe(file.size);
}

function makeFile(byteLength: number, name: string): File {
  return new File(
    [new Blob([new Uint8Array(byteLength)], { type: 'application/octet-stream' })],
    name,
    {
      type: 'application/zip',
    },
  );
}

describe('UploadSkillDialog', () => {
  beforeEach(() => {
    // This spec targets a modal surface; clear body-owned portal nodes so full-suite
    // runs cannot route events to an upload control from an earlier case.
    cleanup();
    document.body.innerHTML = '';
    jest.clearAllMocks();
    mockFileConfigInput = {
      skills: {
        fileSizeLimit: 1,
      },
    };
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('renders the configured skill import size limit', () => {
    render(<UploadSkillDialog isOpen={true} setIsOpen={mockSetIsOpen} />);

    expect(screen.getByText('File size must not exceed 1 MB')).toBeInTheDocument();
  });

  it('renders fractional configured skill import size limits exactly', () => {
    mockFileConfigInput = {
      skills: {
        fileSizeLimit: 1.06,
      },
    };

    render(<UploadSkillDialog isOpen={true} setIsOpen={mockSetIsOpen} />);

    expect(screen.getByText('File size must not exceed 1.06 MB')).toBeInTheDocument();
  });

  it('treats only files above the configured skill import limit as oversized', () => {
    expect(isSkillFileOverSizeLimit(1024 * 1024 + 1, 1024 * 1024)).toBe(true);
    expect(isSkillFileOverSizeLimit(1024 * 1024, 1024 * 1024)).toBe(false);
    expect(isSkillFileOverSizeLimit(1024, 1024 * 1024)).toBe(false);
  });

  it('uploads files exactly at the configured skill import limit', () => {
    render(<UploadSkillDialog isOpen={true} setIsOpen={mockSetIsOpen} />);
    const file = makeFile(1024 * 1024, 'exact-limit.skill');

    dropSkillFile(file);

    expect(mockShowToast).not.toHaveBeenCalled();
    expect(mockMutate).toHaveBeenCalledWith(expect.any(FormData));
    expectSubmittedFile(file);
  });

  it('uploads files under the configured skill import limit', () => {
    render(<UploadSkillDialog isOpen={true} setIsOpen={mockSetIsOpen} />);
    const file = makeFile(1024, 'small.skill');

    dropSkillFile(file);

    expect(mockShowToast).not.toHaveBeenCalled();
    expect(mockMutate).toHaveBeenCalledWith(expect.any(FormData));
    expectSubmittedFile(file);
  });
});
