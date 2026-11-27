import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../app/App';
import { useStore } from '../app/store';

function renderAt(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>);
}
const demo = (scenario: string) => Object.values(useStore.getState().state.tickets).find((t) => t.demo && t.scenario === scenario)!;

describe('UI', () => {
  beforeEach(() => { act(() => useStore.getState().reset()); });

  it('renders overview KPIs derived from state with demo banner', () => {
    renderAt('/overview');
    expect(screen.getByText('Endpoint remediation overview')).toBeInTheDocument();
    expect(screen.getByText(/Demo mode · simulated AI and endpoint actions/)).toBeInTheDocument();
    const kpis = screen.getByTestId('kpis');
    expect(within(kpis).getByText('Total incidents')).toBeInTheDocument();
  });

  it('agent approves storage scenario from detail: execution starts', () => {
    const t = demo('A');
    renderAt(`/incidents/${t.id}`);
    fireEvent.click(screen.getByTestId('approve'));
    expect(useStore.getState().state.tickets[t.id].status).toBe('EXECUTING');
  });

  it('agent cannot approve the HIGH-risk OS patch (disabled with reason)', () => {
    const t = demo('C');
    renderAt(`/incidents/${t.id}`);
    expect(screen.getByTestId('approve')).toBeDisabled();
    expect(screen.getAllByText(/HIGH-risk plans require an Admin approver/).length).toBeGreaterThan(0);
  });

  it('manager role is read-only', () => {
    act(() => { useStore.getState().dispatch({ type: 'SET_ROLE', role: 'MANAGER' }); });
    const t = demo('A');
    renderAt(`/incidents/${t.id}`);
    expect(screen.getByTestId('approve')).toBeDisabled();
    expect(screen.getByTestId('create-ticket')).toBeDisabled();
  });

  it('unknown route shows friendly not-found', () => {
    renderAt('/does-not-exist');
    expect(screen.getByText('Page not found')).toBeInTheDocument();
  });

  it('policies page is read-only for agents and shows computed route matrix', () => {
    renderAt('/policies');
    expect(screen.getByText('Live route matrix')).toBeInTheDocument();
    expect(screen.getByTestId('save-policy')).toBeDisabled();
  });
});
