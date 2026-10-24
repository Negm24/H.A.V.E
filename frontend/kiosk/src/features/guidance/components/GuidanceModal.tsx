import { SymptomsModal } from '../../symptoms/components/SymptomsModal'
export function GuidanceModal({ close }: { close: () => void }) { return <SymptomsModal onClose={close} /> }
