import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../app/App';
import { useStore } from '../app/store';

const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>);
const setRole = (role: 'EMPLOYEE' | 'ADMIN') => act(() => { useStore.getState().dispatch({ type: 'SET_ROLE', role }); });

describe('UI', () => {
  beforeEach(() => { act(() => useStore.getState().reset()); });

  it('exactly two roles: the switcher offers Employee and IT Admin only', () => {
    renderAt('/overview');
    expect(screen.getByTestId('role-employee')).toBeInTheDocument();
    expect(screen.getByTestId('role-admin')).toBeInTheDocument();
    expect(screen.queryByText(/Manager/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Runbook library/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Policies/)).not.toBeInTheDocument();
  });

  it('employee raises a ticket and immediately gets the first guided question', () => {
    setRole('EMPLOYEE');
    renderAt('/raise');
    fireEvent.click(screen.getByLabelText(/Unable to connect to Wi-Fi/));
    fireEvent.change(screen.getByLabelText(/Describe what is happening/), { target: { value: 'Drops every few minutes' } });
    fireEvent.click(screen.getByTestId('submit-ticket'));
    expect(screen.getByTestId('ts-prompt')).toHaveTextContent('Is Wi-Fi turned on on your laptop?');
  });

  it('admin pages are not shown in the employee portal (and vice versa)', () => {
    setRole('EMPLOYEE');
    renderAt('/approvals');
    expect(screen.getByText(/Switch role to open this page/)).toBeInTheDocument();
  });

  it('workspace defaults to All action required, not Overdue', () => {
    setRole('ADMIN');
    renderAt('/workspace');
    expect(screen.getByTestId('filter-ALL')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('filter-OVERDUE')).toHaveAttribute('aria-selected', 'false');
  });

  it('AI settings show approval and verification as always on', () => {
    setRole('ADMIN');
    renderAt('/settings');
    expect(screen.getAllByText('Always on')).toHaveLength(3);
  });
});
