"""initial schema

Revision ID: 20260821_0001
Revises:
Create Date: 2026-08-21 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260821_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "avisos_embarque",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("id_meta", sa.String(length=255), nullable=False),
        sa.Column("chave_nfe", sa.Text(), nullable=True),
        sa.Column("num_nf", sa.Text(), nullable=True),
        sa.Column("fabrica", sa.Text(), nullable=True),
        sa.Column("doca", sa.Text(), nullable=True),
        sa.Column("local_entrega", sa.Text(), nullable=True),
        sa.Column("call_delivery", sa.Text(), nullable=True),
        sa.Column("cod_cliente", sa.Text(), nullable=True),
        sa.Column("emitente_nome", sa.Text(), nullable=True),
        sa.Column("emitente_cnpj", sa.Text(), nullable=True),
        sa.Column("emitente_endereco", sa.Text(), nullable=True),
        sa.Column("destinatario_nome", sa.Text(), nullable=True),
        sa.Column("destinatario_cnpj", sa.Text(), nullable=True),
        sa.Column("data_emissao_nfe", sa.Text(), nullable=True),
        sa.Column("serie_nfe", sa.Text(), nullable=True),
        sa.Column("nat_operacao", sa.Text(), nullable=True),
        sa.Column("itens_json", sa.Text(), nullable=True, server_default="[]"),
        sa.Column("mapeamento_swpaas_id", sa.Text(), nullable=True),
        sa.Column("mapeamento_nome", sa.Text(), nullable=True),
        sa.Column("xml_asn_gerado", sa.Text(), nullable=True),
        sa.Column("rnd004_path", sa.Text(), nullable=True),
        sa.Column("rnd004_length", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("id_meta", name="uq_avisos_id_meta"),
    )
    op.create_index("idx_avisos_id_meta", "avisos_embarque", ["id_meta"], unique=False)

    op.create_table(
        "nfe_label_data",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("chave_acesso", sa.String(length=255), nullable=False),
        sa.Column("etiquetas_json", sa.Text(), nullable=True, server_default="[]"),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.UniqueConstraint("chave_acesso", name="uq_nfe_label_chave"),
    )
    op.create_index("idx_nfe_label_chave", "nfe_label_data", ["chave_acesso"], unique=False)

    op.create_table(
        "label_sequences",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("cliente_codigo", sa.String(length=255), nullable=False),
        sa.Column("sequence_type", sa.String(length=64), nullable=False),
        sa.Column("prefix", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("current_value", sa.BigInteger(), nullable=False, server_default="0"),
        sa.UniqueConstraint("cliente_codigo", "sequence_type", name="uq_cliente_sequence"),
    )


def downgrade() -> None:
    op.drop_table("label_sequences")
    op.drop_index("idx_nfe_label_chave", table_name="nfe_label_data")
    op.drop_table("nfe_label_data")
    op.drop_index("idx_avisos_id_meta", table_name="avisos_embarque")
    op.drop_table("avisos_embarque")
