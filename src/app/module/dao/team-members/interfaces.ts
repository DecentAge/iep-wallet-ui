export interface TeamMember {
    teamMemberWallet: string;
    teamMemberRole: string;
    quantity?: string;
};

export interface Founder {
    founderWalletAlias: string;
    founderWalletAddress: string;
    initialAllocation: string;
};
